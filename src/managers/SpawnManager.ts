import { signals } from '../SignalSystem';
import { RCLStrategy } from './RCLStrategy';
import _ from 'lodash';

interface SpawnRequest {
    role: string;
    roomName: string;
    priority: number;
    rcl: number;
    memory?: CreepMemory;
}

interface SpawnRequestData {
    roomName: string;
    priority?: number;
    rcl?: number;
    memory?: CreepMemory;
    [key: string]: any;
}

/**
 * 管理 Creep 的生成
 * - 监听来自其他管理器的生成请求信号
 * - 维护一个带优先级的生成队列
 * - 在 Spawn 空闲时，执行最高优先级的生成任务
 * - 使用RCL策略动态计算新 Creep 的身体部件
 */
class SpawnManager {
    private spawnQueue: SpawnRequest[] = [];

    constructor() {
        // 监听来自其他管理器的生成请求信号
        signals.connect('spawn.need_supplier', null, (data: SpawnRequestData) => this.requestSpawn('supplier', data));
        signals.connect('spawn.need_miner', null, (data: SpawnRequestData) => this.requestSpawn('miner', data));
        signals.connect('spawn.need_hauler', null, (data: SpawnRequestData) => this.requestSpawn('hauler', data));
        signals.connect('spawn.need_upgrader', null, (data: SpawnRequestData) => this.requestSpawn('upgrader', data));
        signals.connect('spawn.need_builder', null, (data: SpawnRequestData) => this.requestSpawn('builder', data));
        // 兼容旧的 harvester 请求
        signals.connect('spawn.need_harvester', null, (data: SpawnRequestData) => this.requestSpawn('supplier', data));

        // 在每个 tick 开始时处理生成队列
        signals.connect('system.tick_start', null, () => this.processSpawnQueue());
    }

    private requestSpawn(role: string, data: SpawnRequestData): void {
        // 修改防重复逻辑：允许同一房间同一角色的多个请求，但限制队列中的总数
        const sameRoleRequests = this.spawnQueue.filter(req => req.role === role && req.roomName === data.roomName);
        const maxRequestsPerRole = 3; // 每个角色最多在队列中保持3个请求
        
        if (sameRoleRequests.length >= maxRequestsPerRole) return;

        this.spawnQueue.push({
            role: role,
            roomName: data.roomName,
            priority: data.priority || 4, // 默认为低优先级
            rcl: data.rcl || 1,
            memory: data.memory
        });
    }
    
    /**
     * 根据角色和RCL决定 Creep 的身体部件
     * @param role - Creep 角色
     * @param room - 所在房间
     * @param rcl - 房间控制器等级
     * @returns 身体部件数组
     */
    private getBody(role: string, room: Room, rcl: number): BodyPartConstant[] {
        const templates = RCLStrategy.getBodyTemplate(role, rcl);
        const availableEnergy = room.energyAvailable;
        
        // 从模板中选择一个适合当前能量的身体配置
        let selectedTemplate = templates[0]; // 默认使用最小的配置
        
        for (const template of templates) {
            const cost = this.calculateBodyCost(template);
            if (cost <= availableEnergy) {
                selectedTemplate = template;
            } else {
                break; // 模板应该按成本递增排序
            }
        }
        
        return selectedTemplate;
    }

    /**
     * 计算身体部件的成本
     * @param body - 身体部件数组
     * @returns 总成本
     */
    private calculateBodyCost(body: BodyPartConstant[]): number {
        const partCosts = {
            [WORK]: 100,
            [CARRY]: 50,
            [MOVE]: 50,
            [ATTACK]: 80,
            [RANGED_ATTACK]: 150,
            [HEAL]: 250,
            [CLAIM]: 600,
            [TOUGH]: 10
        };
        
        return body.reduce((total, part) => total + (partCosts[part] || 0), 0);
    }

    /**
     * 处理生成队列
     */
    private processSpawnQueue(): void {
        if (this.spawnQueue.length === 0) return;

        // 按优先级排序 (数字越小，优先级越高)
        this.spawnQueue.sort((a, b) => a.priority - b.priority);

        for (const roomName in Game.rooms) {
            const room = Game.rooms[roomName];
            if (!room.controller || !room.controller.my) continue;
            
            const spawns = room.find(FIND_MY_SPAWNS, { filter: s => !s.spawning });
            if (spawns.length === 0) continue;
            
            const spawn = spawns[0]; // 使用第一个可用的 spawn
            
            // 查找此房间最高优先级的请求
            const requestIndex = this.spawnQueue.findIndex(req => req.roomName === roomName);
            if (requestIndex === -1) continue;
            
            const request = this.spawnQueue[requestIndex];
            
            const body = this.getBody(request.role, room, request.rcl);
            const name = `${request.role}-${Game.time}`;
            const memory: CreepMemory = Object.assign({}, request.memory, {
                role: request.role,
                room: room.name,
                building: false,
                upgrading: false,
                hauling: false,
                supplying: false
            });

            const result = spawn.spawnCreep(body, name, { memory });
            if (result === OK) {
                console.log(`[Spawn] 正在生成新的 ${request.role}: ${name} (RCL${request.rcl}, 优先级${request.priority})`);
                // 从队列中移除已处理的请求
                this.spawnQueue.splice(requestIndex, 1);
            } else if (result !== ERR_NOT_ENOUGH_ENERGY) {
                console.log(`[Spawn] 生成 ${request.role} 失败，错误码: ${result}`);
                // 如果不是能量不足，从队列中移除这个失败的请求
                this.spawnQueue.splice(requestIndex, 1);
            }
        }
        
        // 优化队列清理：只在队列过大时清理，而不是定期全部清理
        if (this.spawnQueue.length > 20) {
            console.log(`[Spawn] 队列过大(${this.spawnQueue.length})，清理队列`);
            this.spawnQueue = [];
        }
    }
}

export const spawnManager = new SpawnManager(); 
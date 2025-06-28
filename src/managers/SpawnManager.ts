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
     * @param isEmergency - 是否为紧急情况（该角色creep数量为0）
     * @returns 身体部件数组，如果能量不足且非紧急情况则返回null
     */
    private getBody(role: string, room: Room, rcl: number, isEmergency: boolean = false): BodyPartConstant[] | null {
        const templates = RCLStrategy.getBodyTemplate(role, rcl);
        
        const maxEnergy = room.energyCapacityAvailable;
        const currentEnergy = room.energyAvailable;
        
        // 从模板中选择适合最大能量容量的强力配置
        let bestTemplate = templates[0]; // 默认使用最小的配置
        
        for (const template of templates) {
            const cost = this.calculateBodyCost(template);
            if (cost <= maxEnergy) {
                bestTemplate = template;
            } else {
                break; // 模板应该按成本递增排序
            }
        }
        
        const bestTemplateCost = this.calculateBodyCost(bestTemplate);
        
        // 如果能量已满，直接使用最强配置
        if (currentEnergy >= bestTemplateCost) {
            return bestTemplate;
        }
        
        // 如果不是紧急情况，等待能量充满再生成强力creep
        if (!isEmergency) {
            return null; // 返回null表示暂时不生成，等待能量充满
        }
        
        // 紧急情况下，使用当前能量能负担的最强配置
        let emergencyTemplate = templates[0];
        for (const template of templates) {
            const cost = this.calculateBodyCost(template);
            if (cost <= currentEnergy) {
                emergencyTemplate = template;
            } else {
                break;
            }
        }
        
        return emergencyTemplate;
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
     * 检查某个角色是否处于紧急情况（该角色creep数量为0或即将全部死亡）
     */
    private isEmergencySpawn(role: string, roomName: string): boolean {
        const roomCreeps = _.filter(Game.creeps, creep => 
            creep.memory.role === role && creep.memory.room === roomName
        );
        
        if (roomCreeps.length === 0) {
            return true; // 没有该角色的creep
        }
        
        // 检查是否所有该角色creep都即将死亡（小于50 ticks）
        const dyingCreeps = roomCreeps.filter(creep => 
            creep.ticksToLive && creep.ticksToLive < 50
        );
        
        return dyingCreeps.length === roomCreeps.length;
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
            
            // 检查是否为紧急情况
            const isEmergency = this.isEmergencySpawn(request.role, roomName);
            
            const body = this.getBody(request.role, room, request.rcl, isEmergency);
            
            // 如果body为null，说明能量不足且非紧急情况，等待能量充满
            if (!body) {
                if (Game.time % 50 === 0) { // 每50tick提示一次，避免刷屏
                    console.log(`[Spawn] 等待能量充满以生成强力 ${request.role} (${room.energyAvailable}/${room.energyCapacityAvailable})`);
                }
                continue;
            }
            
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
                const bodyParts = body.length;
                const bodyCost = this.calculateBodyCost(body);
                const emergencyFlag = isEmergency ? ' [紧急]' : '';
                console.log(`[Spawn] 正在生成新的 ${request.role}: ${name}${emergencyFlag} (${bodyParts}部件, ${bodyCost}能量, RCL${request.rcl})`);
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
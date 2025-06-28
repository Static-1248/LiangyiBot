import { signals } from '../SignalSystem';
import { RCLStrategy } from './RCLStrategy';
import _ from 'lodash';

/**
 * 管理升级者 (Upgrader) 的行为
 * - 根据RCL等级调整数量和行为
 * - 在需要时请求生成新的 Upgrader
 * - 监控升级者状态，但不直接控制它们的具体行为
 * - 具体的采集和升级逻辑由UpgraderCreep自己处理
 */
class UpgraderManager {
    constructor() {
        signals.connect('system.tick_start', null, () => this.run());
        
        // 监听升级相关信号
        signals.connect('upgrader.controller_upgraded', null, (data: any) => this.onControllerUpgraded(data));
        signals.connect('upgrader.controller_max_level', null, (data: any) => this.onControllerMaxLevel(data));
    }

    /**
     * 每个 tick 运行的逻辑
     */
    private run(): void {
        for (const roomName in Game.rooms) {
            const room = Game.rooms[roomName];
            if (!room.controller || !room.controller.my) continue;

            const rcl = room.controller.level;
            const strategy = RCLStrategy.getStrategy(rcl);
            const upgraderConfig = strategy.upgrader;

            if (!upgraderConfig.enabled) continue;

            const upgraders = _.filter(Game.creeps, (creep) => 
                creep.memory.role === 'upgrader' && creep.room.name === roomName
            );

            // 如果 Upgrader 数量不足，则发送信号请求生成
            if (upgraders.length < upgraderConfig.maxCount) {
                signals.emit('spawn.need_upgrader', {
                    roomName: roomName,
                    current: upgraders.length,
                    needed: upgraderConfig.maxCount,
                    priority: upgraderConfig.priority,
                    rcl: rcl
                });
            }

            // 让upgrader自己运行，而不是由Manager直接控制
            upgraders.forEach(creep => this.monitorUpgrader(creep));
        }
    }

    /**
     * 监控单个 Upgrader 的状态（不直接控制行为）
     * @param creep - 要监控的 Upgrader Creep
     */
    private monitorUpgrader(creep: Creep): void {
        // 检查upgrader是否正常工作
        if (!creep.spawning) {
            // 可以在这里添加一些监控逻辑，比如检查是否卡住等
            // 但具体的采集和升级行为由UpgraderCreep自己处理
            
            // 例如：检查upgrader是否长时间没有移动
            if (!creep.memory.lastPos) {
                creep.memory.lastPos = { x: creep.pos.x, y: creep.pos.y, time: Game.time };
            } else {
                const lastPos = creep.memory.lastPos;
                if (creep.pos.x === lastPos.x && creep.pos.y === lastPos.y) {
                    if (Game.time - lastPos.time > 10) {
                        // upgrader可能卡住了，可以发出信号
                        if (Game.time % 50 === 0) {
                            console.log(`[UpgraderManager] ${creep.name} 可能卡住了，位置: ${creep.pos}`);
                        }
                    }
                } else {
                    // 更新位置
                    creep.memory.lastPos = { x: creep.pos.x, y: creep.pos.y, time: Game.time };
                }
            }
        }
    }

    /**
     * 处理控制器升级信号
     */
    private onControllerUpgraded(data: { creep: Creep, controller: StructureController, newLevel: number }): void {
        console.log(`🎉 房间 ${data.controller.room.name} 升级到 RCL ${data.newLevel}！升级者：${data.creep.name}`);
        
        // 可以在这里触发一些房间升级后的逻辑
        signals.emit('room.level_upgraded', {
            roomName: data.controller.room.name,
            newLevel: data.newLevel,
            upgrader: data.creep
        });
    }

    /**
     * 处理控制器达到最大等级信号
     */
    private onControllerMaxLevel(data: { creep: Creep, controller: StructureController, level: number }): void {
        console.log(`🏆 房间 ${data.controller.room.name} 已达到最大等级！`);
        
        // 可以考虑减少upgrader数量或者重新分配任务
        signals.emit('room.max_level_reached', {
            roomName: data.controller.room.name,
            level: data.level
        });
    }
}

export const upgraderManager = new UpgraderManager(); 
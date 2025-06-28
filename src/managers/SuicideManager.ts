import { signals } from '../SignalSystem';
import _ from 'lodash';

/**
 * 管理弱小creep的自杀逻辑
 * - 检测过于弱小的creep并让它们自杀
 * - 避免弱小creep占用人口上限
 * - 为更强大的creep腾出空间
 */
class SuicideManager {
    constructor() {
        signals.connect('system.tick_start', null, () => this.run());
    }

    /**
     * 每个 tick 运行的逻辑
     */
    private run(): void {
        for (const roomName in Game.rooms) {
            const room = Game.rooms[roomName];
            if (!room.controller || !room.controller.my) continue;

            const rcl = room.controller.level;
            const roomCreeps = _.filter(Game.creeps, (creep) => creep.room.name === roomName);

            // 检查每个creep是否应该自杀
            roomCreeps.forEach(creep => this.checkForSuicide(creep, rcl, room));
        }
    }

    /**
     * 检查creep是否应该自杀
     * @param creep - 要检查的creep
     * @param rcl - 房间控制器等级
     * @param room - 房间对象
     */
    private checkForSuicide(creep: Creep, rcl: number, room: Room): void {
        // 新生成的creep给一些时间适应（防止刚生成就自杀）
        if (!creep.memory.born) {
            creep.memory.born = Game.time;
        }
        
        const age = Game.time - (creep.memory.born || Game.time);
        if (age < 50) return; // 50 tick内的新creep不考虑自杀

        // 检查creep是否过于弱小
        if (this.isCreepTooWeak(creep, room)) {
            const stats = this.getCreepStats(creep);
            console.log(`🗡️ 发送自杀指令给 ${creep.name}: 过于弱小 (${stats})`);
            
            // 发送自杀指令信号
            signals.emit('creep.should_suicide', {
                creepName: creep.name,
                reason: 'too_weak',
                stats: stats,
                roomName: room.name
            });
        }
    }

    /**
     * 判断creep是否过于弱小
     * @param creep - 要检查的creep
     * @param room - 房间对象
     * @returns 是否过于弱小
     */
    private isCreepTooWeak(creep: Creep, room: Room): boolean {
        const stats = this.getCreepBodyStats(creep);
        const energyCapacity = room.energyCapacityAvailable;
        
        // 如果房间能量容量很低，不要自杀（早期游戏）
        if (energyCapacity < 550) return false;
        
        // 计算creep的总成本
        const creepCost = this.calculateCreepCost(creep);
        
        // 根据角色判断是否过于弱小
        switch (creep.memory.role) {
            case 'supplier':
                // supplier需要足够的carry能力
                return stats.carry < 2 || creepCost < 200;
                
            case 'upgrader':
                // upgrader需要足够的work能力
                return stats.work < 2 || creepCost < 250;
                
            case 'builder':
                // builder需要平衡的work和carry
                return (stats.work + stats.carry) < 3 || creepCost < 200;
                
            case 'miner':
                // miner需要足够的work（至少2个）
                return stats.work < 2 || creepCost < 250;
                
            case 'hauler':
                // hauler需要足够的carry能力
                return stats.carry < 4 || creepCost < 200;
                
            default:
                // 未知角色的通用判断
                return creepCost < 200;
        }
    }

    /**
     * 获取creep的身体部件统计
     * @param creep - creep对象
     * @returns 身体部件统计
     */
    private getCreepBodyStats(creep: Creep): { work: number, carry: number, move: number, total: number } {
        const body = creep.body;
        return {
            work: body.filter(p => p.type === WORK).length,
            carry: body.filter(p => p.type === CARRY).length,
            move: body.filter(p => p.type === MOVE).length,
            total: body.length
        };
    }

    /**
     * 计算creep的总成本
     * @param creep - creep对象
     * @returns 总成本
     */
    private calculateCreepCost(creep: Creep): number {
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
        
        return creep.body.reduce((total, part) => {
            return total + (partCosts[part.type] || 0);
        }, 0);
    }

    /**
     * 获取creep统计信息的字符串表示
     * @param creep - creep对象
     * @returns 统计信息字符串
     */
    private getCreepStats(creep: Creep): string {
        const stats = this.getCreepBodyStats(creep);
        const cost = this.calculateCreepCost(creep);
        return `W:${stats.work} C:${stats.carry} M:${stats.move} Cost:${cost}`;
    }
}

export const suicideManager = new SuicideManager(); 
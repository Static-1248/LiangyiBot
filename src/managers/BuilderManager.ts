import { signals } from '../SignalSystem';
import { RCLStrategy } from './RCLStrategy';
import _ from 'lodash';

/**
 * 管理建筑者 (Builder) 的行为
 * - 根据RCL等级调整数量和优先级
 * - 寻找建筑工地并分配 Builder
 * - 在需要时请求生成新的 Builder
 * - 监控建造者状态，但不直接控制它们的具体行为
 * - 具体的采集和建造逻辑由BuilderCreep自己处理
 */
class BuilderManager {
    constructor() {
        signals.connect('system.tick_start', null, () => this.run());
        
        // 监听建造相关信号
        signals.connect('builder.construction_completed', null, (data: any) => this.onConstructionCompleted(data));
        signals.connect('builder.repair_completed', null, (data: any) => this.onRepairCompleted(data));
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
            const builderConfig = strategy.builder;

            if (!builderConfig.enabled) continue;

            const constructionSites = room.find(FIND_CONSTRUCTION_SITES);
            const builders = _.filter(Game.creeps, (creep) =>
                creep.memory.role === 'builder' && creep.room.name === roomName
            );

            // 修改逻辑：在早期游戏(RCL 1-3)总是保持至少一个builder，即使没有建筑工地
            // 在中后期游戏(RCL 4+)只有在有建筑工地时才生成builder
            let shouldSpawnBuilder = false;
            
            if (rcl <= 3) {
                // 早期游戏：总是保持builder，为未来的建造做准备
                shouldSpawnBuilder = builders.length < builderConfig.maxCount;
            } else {
                // 中后期游戏：只有在有建筑工地时才需要builder
                shouldSpawnBuilder = constructionSites.length > 0 && builders.length < builderConfig.maxCount;
            }

            if (shouldSpawnBuilder) {
                signals.emit('spawn.need_builder', {
                    roomName: roomName,
                    current: builders.length,
                    needed: builderConfig.maxCount,
                    priority: builderConfig.priority,
                    rcl: rcl
                });
            }

            // 监控builder状态，让它们自己处理具体的工作逻辑
            builders.forEach(creep => this.monitorBuilder(creep, constructionSites));
        }
    }

    /**
     * 监控单个 Builder 的状态（不直接控制行为）
     * @param creep - 要监控的 Builder Creep
     * @param sites - 当前房间的建筑工地列表
     */
    private monitorBuilder(creep: Creep, sites: ConstructionSite[]): void {
        // 检查builder是否正常工作
        if (!creep.spawning) {
            // 可以在这里添加一些监控逻辑，比如检查是否卡住等
            // 但具体的建造和采集行为由BuilderCreep自己处理
            
            // 例如：检查builder是否长时间没有移动
            if (!creep.memory.lastPos) {
                creep.memory.lastPos = { x: creep.pos.x, y: creep.pos.y, time: Game.time };
            } else {
                const lastPos = creep.memory.lastPos;
                if (creep.pos.x === lastPos.x && creep.pos.y === lastPos.y) {
                    if (Game.time - lastPos.time > 15) {
                        // builder可能卡住了，可以发出信号
                        if (Game.time % 50 === 0) {
                            console.log(`[BuilderManager] ${creep.name} 可能卡住了，位置: ${creep.pos}`);
                        }
                    }
                } else {
                    // 更新位置
                    creep.memory.lastPos = { x: creep.pos.x, y: creep.pos.y, time: Game.time };
                }
            }
            
            // 如果没有建筑工地，提示builder待机
            if (sites.length === 0 && Game.time % 100 === 0) {
                console.log(`[BuilderManager] 房间 ${creep.room.name} 暂无建筑工地，${creep.name} 待机中`);
            }
        }
    }

    /**
     * 处理建造完成信号
     */
    private onConstructionCompleted(data: { creep: Creep, targetId: string }): void {
        console.log(`🏗️ ${data.creep.name} 完成了建筑任务 ${data.targetId}`);
        
        // 可以在这里触发一些建造完成后的逻辑
        signals.emit('room.construction_progress', {
            roomName: data.creep.room.name,
            builder: data.creep,
            completedTarget: data.targetId
        });
    }

    /**
     * 处理修理完成信号
     */
    private onRepairCompleted(data: { creep: Creep, target: Structure }): void {
        console.log(`🔧 ${data.creep.name} 完成了修理任务`);
        
        // 可以在这里触发一些修理完成后的逻辑
        signals.emit('room.repair_progress', {
            roomName: data.creep.room.name,
            builder: data.creep,
            repairedTarget: data.target
        });
    }
}

export const builderManager = new BuilderManager(); 
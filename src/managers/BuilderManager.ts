import { signals } from '../SignalSystem';
import { RCLStrategy } from './RCLStrategy';
import _ from 'lodash';

/**
 * 管理建筑者 (Builder) 的行为
 * - 根据RCL等级调整数量和优先级
 * - 寻找建筑工地并分配 Builder
 * - 在需要时请求生成新的 Builder
 * - 指挥 Builder 获取能量并建造
 */
class BuilderManager {
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

            // 只有在有建筑工地时才指挥builder工作，否则让它们待机
            if (constructionSites.length > 0) {
                builders.forEach(creep => this.handleBuilder(creep, constructionSites, rcl));
            } else {
                // 没有建筑工地时，让builder待机在spawn附近
                builders.forEach(creep => this.handleIdleBuilder(creep));
            }
        }
    }

    /**
     * 控制单个 Builder 的行为
     * @param creep - 要控制的 Builder Creep
     * @param sites - 当前房间的建筑工地列表
     * @param rcl - 房间控制器等级
     */
    private handleBuilder(creep: Creep, sites: ConstructionSite[], rcl: number): void {
        // 状态切换：如果正在建造但能量耗尽，切换到采集状态
        if (creep.memory.building && creep.store[RESOURCE_ENERGY] === 0) {
            creep.memory.building = false;
            creep.say('🔄 采集');
        }
        // 状态切换：如果正在采集但能量已满，切换到建造状态
        if (!creep.memory.building && creep.store.getFreeCapacity() === 0) {
            creep.memory.building = true;
            creep.say('🚧 建造');
        }

        if (creep.memory.building) {
            this.doBuild(creep, sites);
        } else {
            this.doHarvest(creep, rcl);
        }
    }

    /**
     * 执行建造任务（优化版本）
     * @param creep - Builder creep
     * @param sites - 建筑工地列表
     */
    private doBuild(creep: Creep, sites: ConstructionSite[]): void {
        // 检查是否已有目标，避免重复查找
        if (creep.memory.constructionTarget) {
            const target = Game.getObjectById(creep.memory.constructionTarget as Id<ConstructionSite>);
            if (target) {
                if (creep.build(target) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(target.pos, { visualizePathStyle: { stroke: '#ffffff' } });
                }
                return;
            } else {
                // 目标无效，清除缓存
                delete creep.memory.constructionTarget;
            }
        }

        // 寻找新的建筑工地（减少查找频率）
        if (!creep.memory.constructionTarget || Game.time % 3 === 0) {
            const target = creep.pos.findClosestByRange(sites); // 使用Range而不是Path
            if (target) {
                creep.memory.constructionTarget = target.id;
                if (creep.build(target) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(target.pos, { visualizePathStyle: { stroke: '#ffffff' } });
                }
            }
        }
    }

    /**
     * 执行采集任务（优化版本）
     * @param creep - Builder creep
     * @param rcl - 房间控制器等级
     */
    private doHarvest(creep: Creep, rcl: number): void {
        // 检查是否已有能量目标，避免重复查找
        if (creep.memory.energyTarget) {
            const target = Game.getObjectById(creep.memory.energyTarget) as Structure;
            if (target && this.isValidEnergySource(target)) {
                if (creep.withdraw(target as any, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(target.pos, { visualizePathStyle: { stroke: '#ffaa00' } });
                }
                return;
            } else {
                delete creep.memory.energyTarget;
            }
        }

        // 寻找新能量源（减少查找频率）
        if (!creep.memory.energyTarget || Game.time % 5 === 0) {
            const energySource = this.findBestEnergySource(creep, rcl);
            if (energySource) {
                creep.memory.energyTarget = energySource.id;
                if (creep.withdraw(energySource as any, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(energySource.pos, { visualizePathStyle: { stroke: '#ffaa00' } });
                }
                return;
            }
        }

        // 如果找不到容器/存储，使用source
        this.harvestFromSource(creep);
    }

    /**
     * 检查能量源是否有效
     */
    private isValidEnergySource(target: any): boolean {
        if (!target || !target.store) return false;
        return target.store[RESOURCE_ENERGY] > 0;
    }

    /**
     * 寻找最佳能量源
     */
    private findBestEnergySource(creep: Creep, rcl: number): Structure | null {
        if (!RCLStrategy.shouldUseContainers(rcl)) return null;

        // 查找容器（使用缓存的房间结构）
        const containers = creep.room.find(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_CONTAINER &&
                        (s as StructureContainer).store[RESOURCE_ENERGY] > 0
        });
        if (containers.length > 0) {
            return creep.pos.findClosestByRange(containers) as Structure;
        }

        // 查找存储
        const storage = creep.room.find(FIND_MY_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_STORAGE &&
                        (s as StructureStorage).store[RESOURCE_ENERGY] > 0
        })[0];
        
        return storage || null;
    }

    /**
     * 从source采集
     */
    private harvestFromSource(creep: Creep): void {
        // 检查是否已有source目标
        if (creep.memory.sourceTarget) {
            const source = Game.getObjectById(creep.memory.sourceTarget) as Source;
            if (source && source.energy > 0) {
                if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(source.pos, { visualizePathStyle: { stroke: '#ffaa00' } });
                }
                return;
            } else {
                delete creep.memory.sourceTarget;
            }
        }

        // 寻找新source
        const sources = creep.room.find(FIND_SOURCES_ACTIVE);
        if (sources.length > 0) {
            const source = creep.pos.findClosestByRange(sources);
            if (source) {
                creep.memory.sourceTarget = source.id;
                if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(source.pos, { visualizePathStyle: { stroke: '#ffaa00' } });
                }
            }
        }
    }

    /**
     * 处理待机的Builder
     * @param creep - 待机的Builder creep
     */
    private handleIdleBuilder(creep: Creep): void {
        // 移动到spawn附近待机
        const spawn = creep.pos.findClosestByPath(FIND_MY_SPAWNS);
        if (spawn && creep.pos.getRangeTo(spawn) > 3) {
            creep.moveTo(spawn, { visualizePathStyle: { stroke: '#666666' } });
        }
        creep.say('💤 待机');
    }
}

export const builderManager = new BuilderManager(); 
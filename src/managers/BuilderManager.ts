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
     * 执行建造任务
     * @param creep - Builder creep
     * @param sites - 建筑工地列表
     */
    private doBuild(creep: Creep, sites: ConstructionSite[]): void {
        // 寻找最近的建筑工地进行建造
        const target = creep.pos.findClosestByPath(sites);
        if (target) {
            if (creep.build(target) === ERR_NOT_IN_RANGE) {
                creep.moveTo(target, { visualizePathStyle: { stroke: '#ffffff' } });
            }
        }
    }

    /**
     * 执行采集任务
     * @param creep - Builder creep
     * @param rcl - 房间控制器等级
     */
    private doHarvest(creep: Creep, rcl: number): void {
        // 根据RCL等级选择不同的能量来源
        if (RCLStrategy.shouldUseContainers(rcl)) {
            // RCL 4+: 优先从容器获取能量
            const container = creep.pos.findClosestByPath(FIND_STRUCTURES, {
                filter: (structure) => {
                    return structure.structureType === STRUCTURE_CONTAINER &&
                           (structure as StructureContainer).store[RESOURCE_ENERGY] > 0;
                }
            });

            if (container) {
                if (creep.withdraw(container as StructureContainer, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(container, { visualizePathStyle: { stroke: '#ffaa00' } });
                }
                return;
            }

            // 其次从存储获取
            const storage = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
                filter: (structure) => {
                    return structure.structureType === STRUCTURE_STORAGE &&
                           (structure as StructureStorage).store[RESOURCE_ENERGY] > 0;
                }
            });

            if (storage) {
                if (creep.withdraw(storage as StructureStorage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(storage, { visualizePathStyle: { stroke: '#ffaa00' } });
                }
                return;
            }
        }

        // 早期游戏或没有容器时：直接从source采集
        const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
        if (source && creep.harvest(source) === ERR_NOT_IN_RANGE) {
            creep.moveTo(source, { visualizePathStyle: { stroke: '#ffaa00' } });
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
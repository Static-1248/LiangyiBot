import { signals } from '../SignalSystem';
import { RCLStrategy } from './RCLStrategy';
import _ from 'lodash';

/**
 * 管理升级者 (Upgrader) 的行为
 * - 根据RCL等级调整数量和行为
 * - 在需要时请求生成新的 Upgrader
 * - 指挥 Upgrader 获取能量并升级房间控制器
 */
class UpgraderManager {
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

            upgraders.forEach(creep => this.handleUpgrader(creep, rcl));
        }
    }

    /**
     * 控制单个 Upgrader 的行为
     * @param creep - 要控制的 Upgrader Creep
     * @param rcl - 房间控制器等级
     */
    private handleUpgrader(creep: Creep, rcl: number): void {
        // 状态切换：如果正在升级但能量耗尽，切换到采集状态
        if (creep.memory.upgrading && creep.store[RESOURCE_ENERGY] === 0) {
            creep.memory.upgrading = false;
            creep.say('🔄 采集');
        }
        // 状态切换：如果正在采集但能量已满，切换到升级状态
        if (!creep.memory.upgrading && creep.store.getFreeCapacity() === 0) {
            creep.memory.upgrading = true;
            creep.say('⚡ 升级');
        }

        if (creep.memory.upgrading) {
            this.doUpgrade(creep);
        } else {
            this.doHarvest(creep, rcl);
        }
    }

    /**
     * 执行升级任务
     * @param creep - Upgrader creep
     */
    private doUpgrade(creep: Creep): void {
        const controller = creep.room.controller;
        if (!controller) return;

        if (creep.upgradeController(controller) === ERR_NOT_IN_RANGE) {
            creep.moveTo(controller, { visualizePathStyle: { stroke: '#ffffff' } });
        }
    }

    /**
     * 执行采集任务
     * @param creep - Upgrader creep
     * @param rcl - 房间控制器等级
     */
    private doHarvest(creep: Creep, rcl: number): void {
        // 根据RCL等级选择不同的能量来源
        if (RCLStrategy.shouldUseContainers(rcl)) {
            // RCL 4+: 优先从控制器附近的容器获取能量
            const controller = creep.room.controller;
            if (controller) {
                const upgraderContainer = controller.pos.findInRange(FIND_STRUCTURES, 3, {
                    filter: s => s.structureType === STRUCTURE_CONTAINER &&
                                (s as StructureContainer).store[RESOURCE_ENERGY] > 0
                })[0] as StructureContainer;

                if (upgraderContainer) {
                    if (creep.withdraw(upgraderContainer, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                        creep.moveTo(upgraderContainer, { visualizePathStyle: { stroke: '#ffaa00' } });
                    }
                    return;
                }
            }

            // 其次从其他容器获取
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

            // 最后从存储获取
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
        if (source) {
            if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
                creep.moveTo(source, { visualizePathStyle: { stroke: '#ffaa00' } });
            }
        }
    }
}

export const upgraderManager = new UpgraderManager(); 
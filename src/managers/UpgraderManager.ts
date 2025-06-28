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
        // 检查是否已有目标，避免重复查找
        if (creep.memory.energyTarget) {
            const target = Game.getObjectById(creep.memory.energyTarget) as Structure;
            if (target && this.isValidEnergySource(target)) {
                if (creep.withdraw(target as any, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(target.pos, { visualizePathStyle: { stroke: '#ffaa00' } });
                }
                return;
            } else {
                // 目标无效，清除缓存
                delete creep.memory.energyTarget;
            }
        }

        // 寻找新的能量源（减少查找频率）
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

        // 优先级：控制器附近容器 > 其他容器 > 存储
        const controller = creep.room.controller;
        if (controller) {
            const upgraderContainer = controller.pos.findInRange(FIND_STRUCTURES, 3, {
                filter: s => s.structureType === STRUCTURE_CONTAINER &&
                            (s as StructureContainer).store[RESOURCE_ENERGY] > 0
            })[0];
            if (upgraderContainer) return upgraderContainer;
        }

        // 查找其他容器（缓存房间结构）
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

        // 寻找新source（缓存结果）
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
}

export const upgraderManager = new UpgraderManager(); 
import { signals } from '../SignalSystem';
import { RCLStrategy } from './RCLStrategy';
import _ from 'lodash';

/**
 * 管理搬运工 (Hauler) 的行为
 * - 只在RCL 4+时启用（配合miner-container系统）
 * - 从容器中获取能量并运送到需要的地方
 * - 在需要时请求生成新的 Hauler
 */
class HaulerManager {
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
            const haulerConfig = strategy.hauler;

            // 只在RCL 4+时启用hauler
            if (!haulerConfig.enabled) continue;

            const haulers = _.filter(Game.creeps, (creep) => 
                creep.memory.role === 'hauler' && creep.room.name === roomName
            );
            
            // 只有当存在矿工和容器时才考虑生成 Hauler
            const miners = _.filter(Game.creeps, (creep) => 
                creep.memory.role === 'miner' && creep.room.name === roomName
            );
            const containers = room.find(FIND_STRUCTURES, {
                filter: s => s.structureType === STRUCTURE_CONTAINER
            });

            if (miners.length > 0 && containers.length > 0 && haulers.length < haulerConfig.maxCount) {
                signals.emit('spawn.need_hauler', {
                    roomName: roomName,
                    current: haulers.length,
                    needed: haulerConfig.maxCount,
                    priority: haulerConfig.priority,
                    rcl: rcl
                });
            }

            haulers.forEach(creep => this.handleHauler(creep));
        }
    }

    /**
     * 控制单个 Hauler 的行为
     * @param creep - 要控制的 Hauler Creep
     */
    private handleHauler(creep: Creep): void {
        // 状态切换：如果正在运输但能量已空，切换到获取状态
        if (creep.memory.hauling && creep.store.getUsedCapacity() === 0) {
            creep.memory.hauling = false;
            creep.say('🔄 获取');
        }
        // 状态切换：如果正在获取但能量已满，切换到运输状态
        if (!creep.memory.hauling && creep.store.getFreeCapacity() === 0) {
            creep.memory.hauling = true;
            creep.say('🚚 运输');
        }

        if (creep.memory.hauling) {
            this.doDeliver(creep);
        } else {
            this.doCollect(creep);
        }
    }

    /**
     * 执行运输任务
     * @param creep - Hauler creep
     */
    private doDeliver(creep: Creep): void {
        // 优先为存储设施运输
        const storage = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
            filter: (structure) => {
                return structure.structureType === STRUCTURE_STORAGE &&
                       structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
            }
        });

        if (storage) {
            if (creep.transfer(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                creep.moveTo(storage, { visualizePathStyle: { stroke: '#ffffff' } });
            }
            return;
        }

        // 其次为Tower运输（如果需要）
        const tower = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
            filter: (structure) => {
                return structure.structureType === STRUCTURE_TOWER &&
                       structure.store.getFreeCapacity(RESOURCE_ENERGY) > 300;
            }
        });

        if (tower) {
            if (creep.transfer(tower, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                creep.moveTo(tower, { visualizePathStyle: { stroke: '#ffffff' } });
            }
            return;
        }

        // 最后为升级者容器运输（控制器附近的容器）
        const controller = creep.room.controller;
        if (controller) {
            const upgraderContainer = controller.pos.findInRange(FIND_STRUCTURES, 3, {
                filter: s => s.structureType === STRUCTURE_CONTAINER &&
                            s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
            })[0];

            if (upgraderContainer) {
                if (creep.transfer(upgraderContainer, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(upgraderContainer, { visualizePathStyle: { stroke: '#ffffff' } });
                }
            }
        }
    }

    /**
     * 执行收集任务
     * @param creep - Hauler creep
     */
    private doCollect(creep: Creep): void {
        // 优先捡起地上掉落的能量
        const droppedEnergy = creep.pos.findClosestByPath(FIND_DROPPED_RESOURCES, {
            filter: r => r.resourceType === RESOURCE_ENERGY && r.amount > 50
        });
        
        if (droppedEnergy) {
            if (creep.pickup(droppedEnergy) === ERR_NOT_IN_RANGE) {
                creep.moveTo(droppedEnergy, { visualizePathStyle: { stroke: '#ffaa00' } });
            }
            return;
        }

        // 其次从容器中获取能量（优先选择满的容器）
        const containers = creep.room.find(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_CONTAINER && 
                        (s as StructureContainer).store[RESOURCE_ENERGY] > 200
        }) as StructureContainer[];
        
        containers.sort((a, b) => b.store[RESOURCE_ENERGY] - a.store[RESOURCE_ENERGY]);

        if (containers.length > 0) {
            const container = containers[0];
            if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                creep.moveTo(container, { visualizePathStyle: { stroke: '#ffaa00' } });
            }
        }
    }
}

export const haulerManager = new HaulerManager(); 
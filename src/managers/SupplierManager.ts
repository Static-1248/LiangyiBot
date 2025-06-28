import { signals } from '../SignalSystem';
import { RCLStrategy } from './RCLStrategy';
import { harvestPlanner } from '../planners/HarvestPlanner';
import _ from 'lodash';

/**
 * 管理供应者 (Supplier) 的行为
 * - 为Spawn和Extension提供能量
 * - 在早期游戏（RCL 1-3）中是最重要的角色
 * - 使用采集规划器智能分配矿源，避免拥挤
 * - 支持跨房间挖矿，可以利用相邻房间的矿源
 * - 根据RCL等级调整行为和数量
 */
class SupplierManager {
    constructor() {
        signals.connect('system.tick_start', null, () => this.run());
        
        // 监听矿源分配信号
        signals.connect('harvest.source_assigned', null, (data: any) => this.handleSourceAssignment(data));
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
            const supplierConfig = strategy.supplier;

            if (!supplierConfig.enabled) continue;

            const suppliers = _.filter(Game.creeps, (creep) => 
                creep.memory.role === 'supplier' && creep.room.name === roomName
            );

            // 检查是否需要生成新的supplier
            if (suppliers.length < supplierConfig.maxCount) {
                signals.emit('spawn.need_supplier', {
                    roomName: roomName,
                    current: suppliers.length,
                    needed: supplierConfig.maxCount,
                    priority: supplierConfig.priority,
                    rcl: rcl
                });
            }

            suppliers.forEach(creep => this.handleSupplier(creep, rcl));
        }
    }

    /**
     * 控制单个 Supplier 的行为
     * @param creep - 要控制的 Supplier Creep
     * @param rcl - 房间控制器等级
     */
    private handleSupplier(creep: Creep, rcl: number): void {
        // 状态切换：如果正在供应但能量已空，切换到采集状态
        if (creep.memory.supplying && creep.store.getUsedCapacity() === 0) {
            creep.memory.supplying = false;
            creep.say('🔄 采集');
        }
        // 状态切换：如果正在采集但能量已满，切换到供应状态
        if (!creep.memory.supplying && creep.store.getFreeCapacity() === 0) {
            creep.memory.supplying = true;
            creep.say('🚚 供应');
        }

        if (creep.memory.supplying) {
            this.doSupply(creep);
        } else {
            this.doHarvest(creep, rcl);
        }
    }

    /**
     * 执行供应任务
     * @param creep - Supplier creep
     */
    private doSupply(creep: Creep): void {

        let canSupply = false;

        // 优先为Spawn供应能量
        const spawn = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
            filter: (structure) => {
                return structure.structureType === STRUCTURE_SPAWN &&
                       structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
            }
        });

        if (spawn) {
            canSupply = true;
            if (creep.transfer(spawn, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                creep.moveTo(spawn, { visualizePathStyle: { stroke: '#ffffff' } });
            }
            return;
        }

        // 其次为Extension供应能量
        const extension = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
            filter: (structure) => {
                return structure.structureType === STRUCTURE_EXTENSION &&
                       structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
            }
        });

        if (extension) {
            canSupply = true;
            if (creep.transfer(extension, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                creep.moveTo(extension, { visualizePathStyle: { stroke: '#ffffff' } });
            }
            return;
        }

        // 如果没有需要能量的建筑，检查是否有Tower需要能量
        const tower = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
            filter: (structure) => {
                return structure.structureType === STRUCTURE_TOWER &&
                       structure.store.getFreeCapacity(RESOURCE_ENERGY) > 200; // 只在能量较少时补充
            }
        });

        if (tower) {
            canSupply = true;
            if (creep.transfer(tower, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                creep.moveTo(tower, { visualizePathStyle: { stroke: '#ffffff' } });
            }
        }

        if (!canSupply) {
            // 找到任意spawn作为待机位置
            const anySpawn = creep.pos.findClosestByPath(FIND_MY_SPAWNS);
            if (anySpawn) {
                creep.moveTo(anySpawn, { visualizePathStyle: { stroke: '#ffffff' } }); // 防止creep卡在矿区
            }
        }
    }

    /**
     * 执行采集任务
     * @param creep - Supplier creep
     * @param rcl - 房间控制器等级
     */
    private doHarvest(creep: Creep, rcl: number): void {
        // 根据RCL等级选择不同的能量来源
        if (RCLStrategy.shouldUseContainers(rcl)) {
            // RCL 4+: 优先从容器获取能量
            const container = creep.pos.findClosestByPath(FIND_STRUCTURES, {
                filter: (structure) => {
                    return structure.structureType === STRUCTURE_CONTAINER &&
                           structure.store[RESOURCE_ENERGY] > 100;
                }
            });

            if (container) {
                if (creep.withdraw(container, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(container, { visualizePathStyle: { stroke: '#ffaa00' } });
                }
                return;
            }

            // 其次从存储获取
            const storage = creep.pos.findClosestByPath(FIND_MY_STRUCTURES, {
                filter: (structure) => {
                    return structure.structureType === STRUCTURE_STORAGE &&
                           structure.store[RESOURCE_ENERGY] > 0;
                }
            });

            if (storage) {
                if (creep.withdraw(storage, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(storage, { visualizePathStyle: { stroke: '#ffaa00' } });
                }
                return;
            }
        }

        // 早期游戏或没有容器时：使用采集规划器分配矿源
        this.harvestWithPlanner(creep);
    }

    /**
     * 处理矿源分配信号
     * @param data - 分配数据
     */
    private handleSourceAssignment(data: any): void {
        const creep = Game.creeps[data.creepName];
        if (creep && creep.memory.role === 'supplier') {
            creep.memory.assignedSourceId = data.sourceId;
            console.log(`[SupplierManager] ${data.creepName} 被分配到矿源 ${data.sourceId}`);
        }
    }

    /**
     * 使用采集规划器进行挖矿
     * @param creep - Supplier creep
     */
    private harvestWithPlanner(creep: Creep): void {
        const assignedSourceId = creep.memory.assignedSourceId;
        
        if (assignedSourceId) {
            // 已分配矿源，前往挖矿
            const source = safeGetObjectById(assignedSourceId as Id<Source>);
            if (source) {
                if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(source, { visualizePathStyle: { stroke: '#ffaa00' } });
                }
                return;
            } else {
                // 矿源不存在，清除分配并重新请求
                delete creep.memory.assignedSourceId;
                harvestPlanner.releaseCreepAssignment(creep.name);
            }
        }
        
        // 没有分配矿源，请求分配（限制频率）
        if (!harvestPlanner.getAssignedSource(creep.name)) {
            // 只有在没有最近请求过时才发送新请求
            const lastRequestTime = creep.memory.lastHarvestRequestTime || 0;
            if (Game.time - lastRequestTime >= 5) { // supplier间隔5tick，优先级最高
                signals.emit('harvest.need_source', {
                    creepName: creep.name,
                    roomName: creep.room.name,
                    priority: 3, // supplier优先级较高
                    allowCrossRoom: true // 允许使用相邻房间的矿源
                });
                
                // 记录请求时间
                creep.memory.lastHarvestRequestTime = Game.time;
                
                if (Game.time % 50 === 0) { // 每50tick调试一次
                    console.log(`[SupplierManager 调试] ${creep.name} 请求矿源分配`);
                }
            }
        }
        
        // 在等待分配期间，寻找最近的可用矿源作为临时方案
        const source = creep.pos.findClosestByPath(FIND_SOURCES_ACTIVE);
        if (source) {
            if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
                creep.moveTo(source, { visualizePathStyle: { stroke: '#ffaa00' } });
            }
        }
    }
}

export const supplierManager = new SupplierManager();

/**
 * 安全地通过ID获取对象，处理可能的失效ID
 */
function safeGetObjectById<T extends _HasId>(id: Id<T> | undefined): T | null {
    if (!id) return null;
    
    try {
        return Game.getObjectById(id);
    } catch (error) {
        console.log(`[SupplierManager] 无法找到对象 ID: ${id}`);
        return null;
    }
} 
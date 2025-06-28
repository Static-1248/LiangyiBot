import { signals } from '../SignalSystem';
import { RCLStrategy } from './RCLStrategy';
import { harvestPlanner } from '../planners/HarvestPlanner';
import _ from 'lodash';

/**
 * 管理矿工 (Miner) 的行为
 * - 只在RCL 4+时启用（有容器系统时）
 * - 为每个能量源分配一个 Miner（站桩挖矿）
 * - 使用采集规划器检查矿源位置是否已满
 * - 在需要时请求生成新的 Miner
 * - 指挥 Miner 前往指定能量源并开采
 * - 将能量存入附近的容器
 */
class MinerManager {
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
            const minerConfig = strategy.miner;

            // 只在RCL 4+时启用miner
            if (!minerConfig.enabled) continue;

            const sources = room.find(FIND_SOURCES);
            const miners = _.filter(Game.creeps, (creep) => 
                creep.memory.role === 'miner' && creep.room.name === roomName
            );

            // 为没有分配能量源的 Miner 分配一个
            miners.forEach(miner => {
                if (!miner.memory.sourceId) {
                    const assignedSourceIds = miners.map(m => m.memory.sourceId).filter(id => id);
                    const unassignedSource = sources.find(s => !assignedSourceIds.includes(s.id));
                    if (unassignedSource) {
                        miner.memory.sourceId = unassignedSource.id;
                    }
                }
            });
            
            // 为每个能量源检查是否需要 Miner
            for (const source of sources) {
                const assignedMiners = miners.filter(m => m.memory.sourceId === source.id);
                
                // 检查该源点附近是否有容器或容器建造工地
                const hasContainer = this.hasContainerNearSource(source);
                const hasContainerSite = this.hasContainerSiteNearSource(source);
                
                // 使用采集规划器检查矿源是否已满
                const isSourceFull = harvestPlanner.isSourceFull(source.id);
                
                // 如果有容器且矿源位置未满且当前没有分配的miner，则请求生成miner
                if ((hasContainer || hasContainerSite) && !isSourceFull && assignedMiners.length < 1) {
                    signals.emit('spawn.need_miner', {
                        roomName: roomName,
                        current: miners.length,
                        needed: Math.min(sources.length, minerConfig.maxCount),
                        priority: minerConfig.priority,
                        memory: { sourceId: source.id },
                        rcl: rcl
                    });
                } else if (isSourceFull && Game.time % 100 === 0) {
                    // 每100tick提示一次矿源已满的情况
                    console.log(`[MinerManager] 矿源 ${source.id} 在 ${roomName} 位置已满，暂不派遣miner`);
                }
            }
            
            miners.forEach(creep => this.handleMiner(creep));
        }
    }

    /**
     * 检查源点附近是否有容器
     * @param source - 能量源
     * @returns 是否有容器
     */
    private hasContainerNearSource(source: Source): boolean {
        const containers = source.pos.findInRange(FIND_STRUCTURES, 2, {
            filter: s => s.structureType === STRUCTURE_CONTAINER
        });
        return containers.length > 0;
    }

    /**
     * 检查源点附近是否有容器建造工地
     * @param source - 能量源
     * @returns 是否有容器建造工地
     */
    private hasContainerSiteNearSource(source: Source): boolean {
        const sites = source.pos.findInRange(FIND_CONSTRUCTION_SITES, 2, {
            filter: s => s.structureType === STRUCTURE_CONTAINER
        });
        return sites.length > 0;
    }

    /**
     * 控制单个 Miner 的行为
     * @param creep - 要控制的 Miner Creep
     */
    private handleMiner(creep: Creep): void {
        const sourceId = creep.memory.sourceId as Id<Source> | undefined;
        if (!sourceId) {
            console.log(`${creep.name} has no source assigned!`);
            return;
        }
        
        const source = safeGetObjectById(sourceId);
        if (!source) {
            console.log(`${creep.name} cannot find its source ${sourceId}!`);
            delete creep.memory.sourceId;
            return;
        }

        // 前往并开采能量源
        if (creep.harvest(source) === ERR_NOT_IN_RANGE) {
            creep.moveTo(source, { visualizePathStyle: { stroke: '#ffaa00' } });
            return;
        }

        // 如果能量已满，寻找附近的容器存储
        if (creep.store.getFreeCapacity() === 0) {
            const container = creep.pos.findInRange(FIND_STRUCTURES, 1, {
                filter: s => s.structureType === STRUCTURE_CONTAINER && 
                            s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
            })[0];

            if (container) {
                creep.transfer(container, RESOURCE_ENERGY);
            } else {
                // 如果没有容器，寻找附近的容器
                const nearbyContainer = source.pos.findInRange(FIND_STRUCTURES, 2, {
                    filter: s => s.structureType === STRUCTURE_CONTAINER &&
                                s.store.getFreeCapacity(RESOURCE_ENERGY) > 0
                })[0];
                
                if (nearbyContainer && creep.transfer(nearbyContainer, RESOURCE_ENERGY) === ERR_NOT_IN_RANGE) {
                    creep.moveTo(nearbyContainer, { visualizePathStyle: { stroke: '#ffffff' } });
                }
            }
        }
    }
}

export const minerManager = new MinerManager();

/**
 * 安全地通过ID获取对象，处理可能的失效ID
 */
function safeGetObjectById<T extends _HasId>(id: Id<T> | undefined): T | null {
    if (!id) return null;
    
    try {
        return Game.getObjectById(id);
    } catch (error) {
        console.log(`[MinerManager] 无法找到对象 ID: ${id}`);
        return null;
    }
} 
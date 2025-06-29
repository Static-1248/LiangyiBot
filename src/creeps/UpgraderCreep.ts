/**
 * 升级者Creep类 - 专门负责升级房间控制器
 */
import { BaseCreep, BaseCreepMemory } from './BaseCreep';
import { signal, signals } from '../SignalSystem';
import { harvestPlanner } from '../planners/HarvestPlanner';

// Upgrader内存接口
export interface UpgraderCreepMemory extends BaseCreepMemory {
    role: 'upgrader';
    energySource?: Id<Source | Structure>;
    upgradeTarget?: Id<StructureController>;
    containerPos?: RoomPosition;
    assignedSourceId?: Id<Source>;
    lastHarvestRequestTime?: number;
}

export class UpgraderCreep extends BaseCreep {
    protected creepMemory: UpgraderCreepMemory;

    constructor(creep: Creep) {
        super(creep);
        
        // 定义Upgrader特有信号
        this.defineSignal('upgrader.started_upgrading');
        this.defineSignal('upgrader.controller_upgraded');
        this.defineSignal('upgrader.seeking_energy');
        this.defineSignal('upgrader.at_container');
        this.defineSignal('upgrader.controller_max_level');

        // 初始化Upgrader内存
        this.creepMemory = this.creepMemory as UpgraderCreepMemory;
        this.creepMemory.role = 'upgrader';
        
        // 设置升级目标为当前房间的控制器
        if (this.creep.room.controller && this.creep.room.controller.my) {
            this.creepMemory.upgradeTarget = this.creep.room.controller.id;
        }
        
        // 自动连接信号
        this.autoConnectSignals();
    }

    /**
     * 寻找能量来源（优先容器，其次使用HarvestPlanner）
     */
    public findEnergySource(): Source | Structure | null {
        // 优先寻找控制器附近的容器
        const controller = this.getUpgradeTarget();
        if (controller) {
            const nearbyContainers = controller.pos.findInRange(FIND_STRUCTURES, 3, {
                filter: (structure) => {
                    return structure.structureType === STRUCTURE_CONTAINER &&
                           structure.store.energy > 0;
                }
            });
            
            if (nearbyContainers.length > 0) {
                return nearbyContainers[0] as StructureContainer;
            }
        }

        // 其次寻找存储建筑
        const storage = this.findClosest(FIND_STRUCTURES, (structure) => {
            return (structure.structureType === STRUCTURE_STORAGE ||
                    structure.structureType === STRUCTURE_CONTAINER) &&
                   structure.store.energy > 0;
        });

        if (storage) return storage as Structure;

        // 如果没有容器和存储，使用HarvestPlanner请求矿源分配
        return this.getAssignedSource();
    }

    /**
     * 获取分配的矿源
     */
    private getAssignedSource(): Source | null {
        const assignedSourceId = this.creepMemory.assignedSourceId;
        
        if (assignedSourceId) {
            // 已分配矿源，验证是否仍然有效
            const source = this.safeGetObjectById(assignedSourceId);
            if (source && source.energy > 0) {
                return source;
            } else {
                // 矿源无效，清除分配并重新请求
                delete this.creepMemory.assignedSourceId;
                harvestPlanner.releaseCreepAssignment(this.creep.name);
            }
        }
        
        // 没有分配矿源，请求分配（限制频率）
        if (!harvestPlanner.getAssignedSource(this.creep.name)) {
            // 只有在没有最近请求过时才发送新请求
            const lastRequestTime = this.creepMemory.lastHarvestRequestTime || 0;
            if (Game.time - lastRequestTime >= 10) { // 至少间隔10tick才能重新请求
                signals.emit('harvest.need_source', {
                    creepName: this.creep.name,
                    roomName: this.creep.room.name,
                    priority: 4, // upgrader优先级中等
                    allowCrossRoom: false // upgrader通常不跨房间
                });
                
                // 记录请求时间
                this.creepMemory.lastHarvestRequestTime = Game.time;
                
                if (Game.time % 50 === 0) { // 每50tick调试一次
                    console.log(`[UpgraderCreep] ${this.creep.name} 请求矿源分配`);
                }
            }
        }
        
        // 在等待分配期间，寻找最近的可用矿源作为临时方案
        const source = this.findClosest(FIND_SOURCES, (source) => source.energy > 0);
        return source;
    }

    /**
     * 获取升级目标
     */
    public getUpgradeTarget(): StructureController | null {
        if (this.creepMemory.upgradeTarget) {
            const target = this.safeGetObjectById(this.creepMemory.upgradeTarget);
            if (target && target.my) return target;
        }

        // 寻找当前房间的控制器
        const controller = this.creep.room.controller;
        if (controller && controller.my) {
            this.creepMemory.upgradeTarget = controller.id;
            return controller;
        }

        return null;
    }

    /**
     * 执行升级
     */
    public doUpgrade(): boolean {
        const target = this.getUpgradeTarget();
        if (!target) return false;

        // 检查控制器是否已达到最大等级
        if (target.level >= 8) {
            this.emitSignal('upgrader.controller_max_level', {
                creep: this.creep,
                controller: target,
                level: target.level
            });
            this.say('🏆MAX!');
            return false;
        }

        const result = this.creep.upgradeController(target);
        if (result === OK) {
            // 检查是否升级成功
            if (target.progress === 0) {
                this.emitSignal('upgrader.controller_upgraded', {
                    creep: this.creep,
                    controller: target,
                    newLevel: target.level
                });
            }
            
            return true;
        } else if (result === ERR_NOT_IN_RANGE) {
            this.moveTo(target);
            return true;
        }
        return false;
    }

    /**
     * 收集能量
     */
    public doHarvest(): boolean {
        const source = this.getEnergySource();
        if (!source) return false;

        let result: ScreepsReturnCode;
        
        if (source instanceof Source) {
            result = this.creep.harvest(source);
        } else {
            result = this.creep.withdraw(source as any, RESOURCE_ENERGY);
        }

        if (result === OK) {
            // 如果在容器附近，发射信号
            if (source instanceof Structure && source.structureType === STRUCTURE_CONTAINER) {
                this.emitSignal('upgrader.at_container', {
                    creep: this.creep,
                    container: source
                });
            }
            
            return true;
        } else if (result === ERR_NOT_IN_RANGE) {
            this.moveTo(source);
            return true;
        }
        return false;
    }

    /**
     * 获取当前能量源
     */
    private getEnergySource(): Source | Structure | null {
        if (this.creepMemory.energySource) {
            const source = this.safeGetObjectById(this.creepMemory.energySource);
            if (source) {
                if (source instanceof Source && source.energy > 0) return source;
                if (source instanceof Structure && 'store' in source && (source as any).store.energy > 0) return source;
            }
            this.creepMemory.energySource = undefined;
        }

        const newSource = this.findEnergySource();
        if (newSource) {
            this.creepMemory.energySource = newSource.id;
        }
        return newSource;
    }

    /**
     * 检查是否应该建造控制器容器
     */
    private checkControllerContainer(): void {
        const controller = this.getUpgradeTarget();
        if (!controller) return;

        // 寻找控制器附近是否有容器或建造点
        const nearbyContainers = controller.pos.findInRange(FIND_STRUCTURES, 3, {
            filter: (structure) => structure.structureType === STRUCTURE_CONTAINER
        });

        const nearbyConstructionSites = controller.pos.findInRange(FIND_CONSTRUCTION_SITES, 3, {
            filter: (site) => site.structureType === STRUCTURE_CONTAINER
        });

        // 如果没有容器也没有建造点，建议建造一个
        if (nearbyContainers.length === 0 && nearbyConstructionSites.length === 0) {
            // 寻找合适的位置建造容器
            const positions: RoomPosition[] = [];
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx === 0 && dy === 0) continue;
                    const x = controller.pos.x + dx;
                    const y = controller.pos.y + dy;
                    if (x >= 0 && x < 50 && y >= 0 && y < 50) {
                        const pos = new RoomPosition(x, y, controller.room.name);
                        const terrain = this.creep.room.getTerrain();
                        if (terrain.get(pos.x, pos.y) !== TERRAIN_MASK_WALL) {
                            positions.push(pos);
                        }
                    }
                }
            }

            if (positions.length > 0) {
                this.emitSignal('upgrader.container_needed', {
                    creep: this.creep,
                    controller: controller,
                    suggestedPos: positions[0]
                });
            }
        }
    }

    /**
     * 主要工作逻辑
     */
    protected doWork(): void {
        // 状态切换逻辑：如果正在升级但能量空了，切换到采集
        if (this.creepMemory.state === 'upgrading' && this.creep.store.energy === 0) {
            this.setState('harvesting');
            this.say('🔋去采集');
            this.emitSignal('upgrader.seeking_energy', { creep: this.creep });
        }
        // 状态切换逻辑：如果正在采集但能量满了，切换到升级
        else if (this.creepMemory.state === 'harvesting' && this.creep.store.getFreeCapacity() === 0) {
            this.setState('upgrading');
            this.say('⬆️去升级');
            this.emitSignal('upgrader.started_upgrading', { 
                creep: this.creep,
                controller: this.getUpgradeTarget()
            });
        }
        // 初始状态：如果没有状态，根据能量情况设置初始状态
        else if (!this.creepMemory.state || this.creepMemory.state === 'idle') {
            if (this.creep.store.energy === 0) {
                this.setState('harvesting');
                this.emitSignal('upgrader.seeking_energy', { creep: this.creep });
            } else {
                this.setState('upgrading');
                this.emitSignal('upgrader.started_upgrading', { 
                    creep: this.creep,
                    controller: this.getUpgradeTarget()
                });
            }
        }

        // 根据当前状态执行对应任务
        if (this.creepMemory.state === 'upgrading') {
            // 检查控制器容器情况
            if (Game.time % 50 === 0) {
                this.checkControllerContainer();
            }
            this.doUpgrade();
        } else if (this.creepMemory.state === 'harvesting') {
            this.doHarvest();
        }
    }

    /**
     * 信号监听器：能量满了时开始升级
     */
    @signal('creep.energy_full', 15)
    protected onEnergyFull(data: any): void {
        if (data.creep === this.creep) {
            this.setState('upgrading');
            this.say('⬆️开始升级!');
        }
    }

    /**
     * 信号监听器：能量空了时去采集
     */
    @signal('creep.energy_empty', 15)
    protected onEnergyEmpty(data: any): void {
        if (data.creep === this.creep) {
            this.setState('harvesting');
            this.say('🔋去采集能量');
        }
    }

    /**
     * 信号监听器：升级任务分配
     */
    @signal('upgrade.target_assigned', 20)
    protected onUpgradeTargetAssigned(data: { creep: Creep, target: StructureController }): void {
        if (data.creep === this.creep) {
            this.creepMemory.upgradeTarget = data.target.id;
            this.setState('upgrading');
            this.say('🎯新升级目标');
        }
    }

    /**
     * 信号监听器：容器位置建议
     */
    @signal('upgrader.container_needed', 10)
    protected onContainerNeeded(data: { creep: Creep, controller: StructureController, suggestedPos: RoomPosition }): void {
        // 这个信号可以被建筑管理器监听，用于规划容器建造
        console.log(`💡 ${this.creep.name} 建议在 ${data.suggestedPos} 建造容器`);
    }

    /**
     * 获取升级效率
     */
    public getUpgradeEfficiency(): number {
        const controller = this.getUpgradeTarget();
        if (!controller) return 0;

        const workParts = this.creep.body.filter(part => part.type === WORK).length;
        return workParts;
    }

    /**
     * 检查是否在升级位置
     */
    public isInUpgradePosition(): boolean {
        const controller = this.getUpgradeTarget();
        if (!controller) return false;

        return this.creep.pos.inRangeTo(controller, 3);
    }

    /**
     * 移动到最佳升级位置
     */
    public moveToUpgradePosition(): void {
        const controller = this.getUpgradeTarget();
        if (!controller) return;

        // 寻找控制器附近的容器
        const container = controller.pos.findInRange(FIND_STRUCTURES, 3, {
            filter: (structure) => structure.structureType === STRUCTURE_CONTAINER
        })[0] as StructureContainer;

        if (container) {
            // 移动到容器上
            this.moveTo(container);
        } else {
            // 移动到控制器附近
            this.moveTo(controller);
        }
    }

    /**
     * 运行Upgrader逻辑
     */
    public run(): void {
        super.run();
        
        // 如果不在升级位置且没有在移动，则移动到升级位置
        if (!this.isInUpgradePosition() && this.creep.store.energy > 0) {
            this.moveToUpgradePosition();
        }
    }

    /**
     * 信号监听器：矿源分配
     */
    @signal('harvest.source_assigned', 15)
    protected onSourceAssigned(data: { creepName: string, sourceId: string, roomName: string }): void {
        if (data.creepName === this.creep.name) {
            this.creepMemory.assignedSourceId = data.sourceId as Id<Source>;
            console.log(`[UpgraderCreep] ${this.creep.name} 被分配到矿源 ${data.sourceId}`);
        }
    }
} 
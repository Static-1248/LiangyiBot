/**
 * 建造者Creep类 - 负责建筑建造
 */
import { BaseCreep, BaseCreepMemory } from './BaseCreep';
import { signal, signals } from '../SignalSystem';
import { harvestPlanner } from '../planners/HarvestPlanner';

// Builder内存接口
export interface BuilderCreepMemory extends BaseCreepMemory {
    role: 'builder';
    buildTarget?: Id<ConstructionSite>;
    repairTarget?: Id<Structure>;
    energySource?: Id<Source | Structure>;
    assignedSourceId?: Id<Source>;
    lastHarvestRequestTime?: number;
}

export class BuilderCreep extends BaseCreep {
    protected creepMemory: BuilderCreepMemory;

    constructor(creep: Creep) {
        super(creep);
        
        // 定义Builder特有信号
        this.defineSignal('builder.construction_started');
        this.defineSignal('builder.construction_completed');
        this.defineSignal('builder.repair_started');
        this.defineSignal('builder.repair_completed');
        this.defineSignal('builder.seeking_energy');
        this.defineSignal('builder.seeking_work');

        // 初始化Builder内存
        this.creepMemory = this.creepMemory as BuilderCreepMemory;
        this.creepMemory.role = 'builder';
        
        // 自动连接信号
        this.autoConnectSignals();
    }

    /**
     * 寻找建造目标
     */
    public findConstructionTarget(): ConstructionSite | null {
        return this.findClosest(FIND_CONSTRUCTION_SITES);
    }

    /**
     * 寻找修理目标
     */
    public findRepairTarget(): Structure | null {
        return this.findClosest(FIND_STRUCTURES, (structure) => {
            return structure.hits < structure.hitsMax && 
                   structure.structureType !== STRUCTURE_WALL &&
                   structure.structureType !== STRUCTURE_RAMPART;
        });
    }

    /**
     * 寻找能量来源（优先容器，其次使用HarvestPlanner）
     */
    public findEnergySource(): Source | Structure | null {
        // 优先寻找容器或存储
        const container = this.findClosest(FIND_STRUCTURES, (structure) => {
            return (structure.structureType === STRUCTURE_CONTAINER ||
                    structure.structureType === STRUCTURE_STORAGE) &&
                   structure.store.energy > 0;
        });

        if (container) return container as Structure;

        // 如果没有容器，使用HarvestPlanner请求矿源分配
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
            if (Game.time - lastRequestTime >= 15) { // builder间隔15tick，优先级较低
                signals.emit('harvest.need_source', {
                    creepName: this.creep.name,
                    roomName: this.creep.room.name,
                    priority: 5, // builder优先级较低
                    allowCrossRoom: false // builder通常不跨房间
                });
                
                // 记录请求时间
                this.creepMemory.lastHarvestRequestTime = Game.time;
                
                if (Game.time % 50 === 0) { // 每50tick调试一次
                    console.log(`[BuilderCreep] ${this.creep.name} 请求矿源分配`);
                }
            }
        }
        
        // 在等待分配期间，寻找最近的可用矿源作为临时方案
        const source = this.findClosest(FIND_SOURCES, (source) => source.energy > 0);
        return source;
    }

    /**
     * 执行建造
     */
    public doBuild(): boolean {
        const target = this.getConstructionTarget();
        if (!target) return false;

        const result = this.creep.build(target);
        if (result === OK) {
            return true;
        } else if (result === ERR_NOT_IN_RANGE) {
            this.moveTo(target);
            return true;
        }
        return false;
    }

    /**
     * 执行修理
     */
    public doRepair(): boolean {
        const target = this.getRepairTarget();
        if (!target) return false;

        const result = this.creep.repair(target);
        if (result === OK) {
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
            return true;
        } else if (result === ERR_NOT_IN_RANGE) {
            this.moveTo(source);
            return true;
        }
        return false;
    }

    /**
     * 获取当前建造目标
     */
    private getConstructionTarget(): ConstructionSite | null {
        if (this.creepMemory.buildTarget) {
            const target = this.safeGetObjectById(this.creepMemory.buildTarget);
            if (target) return target;
            this.creepMemory.buildTarget = undefined;
        }

        const newTarget = this.findConstructionTarget();
        if (newTarget) {
            this.creepMemory.buildTarget = newTarget.id;
            this.emitSignal('builder.construction_started', {
                creep: this.creep,
                target: newTarget
            });
        }
        return newTarget;
    }

    /**
     * 获取当前修理目标
     */
    private getRepairTarget(): Structure | null {
        if (this.creepMemory.repairTarget) {
            const target = this.safeGetObjectById(this.creepMemory.repairTarget);
            if (target && target.hits < target.hitsMax) return target;
            this.creepMemory.repairTarget = undefined;
        }

        const newTarget = this.findRepairTarget();
        if (newTarget) {
            this.creepMemory.repairTarget = newTarget.id;
            this.emitSignal('builder.repair_started', {
                creep: this.creep,
                target: newTarget
            });
        }
        return newTarget;
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
     * 主要工作逻辑
     */
    protected doWork(): void {
        // 状态切换逻辑：如果正在工作但能量空了，切换到采集
        if (this.creepMemory.state === 'working' && this.creep.store.energy === 0) {
            this.setState('harvesting');
            this.say('🔋去采集');
            this.emitSignal('builder.seeking_energy', { creep: this.creep });
        }
        // 状态切换逻辑：如果正在采集但能量满了，切换到工作
        else if (this.creepMemory.state === 'harvesting' && this.creep.store.getFreeCapacity() === 0) {
            this.setState('working');
            this.say('🔨去工作');
            this.emitSignal('builder.seeking_work', { creep: this.creep });
        }
        // 初始状态：如果没有状态，根据能量情况设置初始状态
        else if (!this.creepMemory.state || this.creepMemory.state === 'idle') {
            if (this.creep.store.energy === 0) {
                this.setState('harvesting');
                this.emitSignal('builder.seeking_energy', { creep: this.creep });
            } else {
                this.setState('working');
                this.emitSignal('builder.seeking_work', { creep: this.creep });
            }
        }

        // 根据当前状态执行对应任务
        if (this.creepMemory.state === 'harvesting') {
            this.doHarvest();
        } else if (this.creepMemory.state === 'working') {
            // 优先建造，其次修理
            if (!this.doBuild()) {
                this.doRepair();
            }
        }
    }

    /**
     * 信号监听器：能量满了时开始工作
     */
    @signal('creep.energy_full', 15)
    protected onEnergyFull(data: any): void {
        if (data.creep === this.creep) {
            this.setState('working');
            this.say('💪开始工作!');
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
     * 信号监听器：建造任务分配
     */
    @signal('building.construction_assigned', 20)
    protected onConstructionAssigned(data: { creep: Creep, target: ConstructionSite }): void {
        if (data.creep === this.creep) {
            this.creepMemory.buildTarget = data.target.id;
            this.setState('building');
            this.say('🏗️新建造任务');
        }
    }

    /**
     * 信号监听器：修理任务分配
     */
    @signal('building.repair_assigned', 20)
    protected onRepairAssigned(data: { creep: Creep, target: Structure }): void {
        if (data.creep === this.creep) {
            this.creepMemory.repairTarget = data.target.id;
            this.setState('repairing');
            this.say('🔧新修理任务');
        }
    }

    /**
     * 检查建造是否完成
     */
    private checkBuildingCompletion(): void {
        if (this.creepMemory.buildTarget) {
            const target = this.safeGetObjectById(this.creepMemory.buildTarget);
            if (!target) {
                // 建造完成
                this.emitSignal('builder.construction_completed', {
                    creep: this.creep,
                    targetId: this.creepMemory.buildTarget
                });
                this.creepMemory.buildTarget = undefined;
            }
        }
    }

    /**
     * 信号监听器：矿源分配
     */
    @signal('harvest.source_assigned', 15)
    protected onSourceAssigned(data: { creepName: string, sourceId: string, roomName: string }): void {
        if (data.creepName === this.creep.name) {
            this.creepMemory.assignedSourceId = data.sourceId as Id<Source>;
            console.log(`[BuilderCreep] ${this.creep.name} 被分配到矿源 ${data.sourceId}`);
        }
    }

    /**
     * 运行Builder逻辑
     */
    public run(): void {
        super.run();
        this.checkBuildingCompletion();
    }
} 
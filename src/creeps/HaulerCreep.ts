/**
 * 搬运工Creep类 - 专门负责搬运资源
 */
import { BaseCreep, BaseCreepMemory } from './BaseCreep';
import { signal } from '../SignalSystem';

// 搬运任务接口
export interface HaulerTask {
    id: string;
    from: Id<Structure>;
    to: Id<Structure>;
    resourceType: ResourceConstant;
    amount?: number;
    priority: 'urgent' | 'high' | 'normal' | 'low';
    createdTime: number;
    assignedCreep?: string;
}

// Hauler内存接口
export interface HaulerCreepMemory extends BaseCreepMemory {
    role: 'hauler';
    currentTask?: string;
    pickupTarget?: Id<Structure>;
    deliveryTarget?: Id<Structure>;
    resourceType?: ResourceConstant;
}

export class HaulerCreep extends BaseCreep {
    protected creepMemory: HaulerCreepMemory;

    constructor(creep: Creep) {
        super(creep);
        
        // 定义Hauler特有信号
        this.defineSignal('hauler.task_assigned');
        this.defineSignal('hauler.task_completed');
        this.defineSignal('hauler.pickup_completed');
        this.defineSignal('hauler.delivery_completed');
        this.defineSignal('hauler.seeking_task');
        this.defineSignal('hauler.stuck');

        // 初始化Hauler内存
        this.creepMemory = this.creepMemory as HaulerCreepMemory;
        this.creepMemory.role = 'hauler';
        
        // 自动连接信号
        this.autoConnectSignals();
    }

    /**
     * 执行拾取
     */
    public doPickup(): boolean {
        if (!this.creepMemory.pickupTarget) return false;

        const target = Game.getObjectById(this.creepMemory.pickupTarget);
        if (!target) {
            this.creepMemory.pickupTarget = undefined;
            return false;
        }

        const resourceType = this.creepMemory.resourceType || RESOURCE_ENERGY;
        
        // 检查目标是否有资源
        if (!('store' in target) || !target.store || (target.store as any)[resourceType] === 0) {
            this.say('❌无资源');
            this.completePickup();
            return false;
        }

        const result = this.creep.withdraw(target as any, resourceType);
        
        if (result === OK) {
            this.say('📥拾取中');
            
            // 检查是否拾取完毕
            if (this.creep.store.getFreeCapacity() === 0) {
                this.completePickup();
            }
            
            return true;
        } else if (result === ERR_NOT_IN_RANGE) {
            this.moveTo(target);
            return true;
        } else if (result === ERR_FULL) {
            this.completePickup();
            return true;
        }
        
        return false;
    }

    /**
     * 执行交付
     */
    public doDelivery(): boolean {
        if (!this.creepMemory.deliveryTarget) return false;

        const target = Game.getObjectById(this.creepMemory.deliveryTarget);
        if (!target) {
            this.creepMemory.deliveryTarget = undefined;
            return false;
        }

        const resourceType = this.creepMemory.resourceType || RESOURCE_ENERGY;
        
        // 检查creep是否有资源
        if (this.creep.store[resourceType] === 0) {
            this.completeDelivery();
            return false;
        }

        const result = this.creep.transfer(target as any, resourceType);
        
        if (result === OK) {
            this.say('📤交付中');
            
            // 检查是否交付完毕
            if (this.creep.store[resourceType] === 0) {
                this.completeDelivery();
            }
            
            return true;
        } else if (result === ERR_NOT_IN_RANGE) {
            this.moveTo(target);
            return true;
        } else if (result === ERR_FULL) {
            this.say('❌目标满了');
            this.completeDelivery();
            return false;
        }
        
        return false;
    }

    /**
     * 完成拾取
     */
    private completePickup(): void {
        this.emitSignal('hauler.pickup_completed', {
            creep: this.creep,
            target: this.creepMemory.pickupTarget,
            resourceType: this.creepMemory.resourceType
        });
        
        this.creepMemory.pickupTarget = undefined;
        this.setState('delivering');
    }

    /**
     * 完成交付
     */
    private completeDelivery(): void {
        this.emitSignal('hauler.delivery_completed', {
            creep: this.creep,
            target: this.creepMemory.deliveryTarget,
            resourceType: this.creepMemory.resourceType
        });
        
        this.completeCurrentTask();
    }

    /**
     * 完成当前任务
     */
    private completeCurrentTask(): void {
        if (this.creepMemory.currentTask) {
            this.emitSignal('hauler.task_completed', {
                creep: this.creep,
                taskId: this.creepMemory.currentTask
            });
        }
        
        this.creepMemory.currentTask = undefined;
        this.creepMemory.pickupTarget = undefined;
        this.creepMemory.deliveryTarget = undefined;
        this.creepMemory.resourceType = undefined;
        this.setState('idle');
    }

    /**
     * 分配任务
     */
    public assignTask(task: HaulerTask): void {
        this.creepMemory.currentTask = task.id;
        this.creepMemory.pickupTarget = task.from;
        this.creepMemory.deliveryTarget = task.to;
        this.creepMemory.resourceType = task.resourceType;
        
        this.emitSignal('hauler.task_assigned', {
            creep: this.creep,
            task: task
        });
        
        this.setState('picking_up');
        this.say(`📋${task.priority}`);
    }

    /**
     * 寻找合适的拾取目标（紧急模式）
     */
    public findPickupTarget(): Structure | null {
        // 寻找满的容器
        const containers = this.creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => {
                return structure.structureType === STRUCTURE_CONTAINER &&
                       structure.store.energy > 100; // 至少100能量才值得搬运
            }
        }) as StructureContainer[];

        if (containers.length > 0) {
            // 按使用率排序，优先搬运最满的
            containers.sort((a, b) => {
                const usageA = a.store.energy / a.store.getCapacity();
                const usageB = b.store.energy / b.store.getCapacity();
                return usageB - usageA;
            });
            
            return containers[0];
        }

        return null;
    }

    /**
     * 寻找合适的交付目标
     */
    public findDeliveryTarget(): Structure | null {
        // 优先交付给spawn和extension
        const energyStructures = this.creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => {
                return (structure.structureType === STRUCTURE_SPAWN ||
                        structure.structureType === STRUCTURE_EXTENSION) &&
                       structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
            }
        }) as (StructureSpawn | StructureExtension)[];

        if (energyStructures.length > 0) {
            return this.creep.pos.findClosestByPath(energyStructures);
        }

        // 其次交付给塔
        const towers = this.creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => {
                return structure.structureType === STRUCTURE_TOWER &&
                       structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
            }
        }) as StructureTower[];

        if (towers.length > 0) {
            return this.creep.pos.findClosestByPath(towers);
        }

        // 最后交付给存储
        const storage = this.creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => {
                return structure.structureType === STRUCTURE_STORAGE &&
                       structure.store.getFreeCapacity() > 0;
            }
        })[0] as StructureStorage;

        return storage || null;
    }

    /**
     * 自主工作模式（没有任务时）
     */
    private autonomousWork(): void {
        // 如果有资源，寻找交付目标
        if (this.creep.store.energy > 0) {
            if (this.creepMemory.state !== 'delivering') {
                this.setState('delivering');
                
                if (!this.creepMemory.deliveryTarget) {
                    const target = this.findDeliveryTarget();
                    if (target) {
                        this.creepMemory.deliveryTarget = target.id;
                        this.creepMemory.resourceType = RESOURCE_ENERGY;
                    }
                }
            }
            
            this.doDelivery();
        } else {
            // 如果没有资源，寻找拾取目标
            if (this.creepMemory.state !== 'picking_up') {
                this.setState('picking_up');
                
                if (!this.creepMemory.pickupTarget) {
                    const target = this.findPickupTarget();
                    if (target) {
                        this.creepMemory.pickupTarget = target.id;
                        this.creepMemory.resourceType = RESOURCE_ENERGY;
                    } else {
                        this.setState('idle');
                        this.say('💤待命');
                        return;
                    }
                }
            }
            
            this.doPickup();
        }
    }

    /**
     * 主要工作逻辑
     */
    protected doWork(): void {
        // 如果有任务，执行任务
        if (this.creepMemory.currentTask) {
            if (this.creepMemory.state === 'picking_up') {
                if (!this.doPickup()) {
                    // 拾取失败，完成任务
                    this.completeCurrentTask();
                }
            } else if (this.creepMemory.state === 'delivering') {
                if (!this.doDelivery()) {
                    // 交付失败，完成任务
                    this.completeCurrentTask();
                }
            }
        } else {
            // 没有任务，寻求新任务
            if (this.creepMemory.state !== 'seeking_task') {
                this.setState('seeking_task');
                this.emitSignal('hauler.seeking_task', { creep: this.creep });
            }
            
            // 自主工作
            this.autonomousWork();
        }
    }

    /**
     * 信号监听器：任务分配
     */
    @signal('hauler.task_assigned', 20)
    protected onTaskAssigned(data: { creep: Creep, task: HaulerTask }): void {
        if (data.creep === this.creep) {
            console.log(`📋 ${this.creep.name} 接受任务: ${data.task.priority}`);
        }
    }

    /**
     * 信号监听器：hauler请求
     */
    @signal('hauler.request', 15)
    protected onHaulerRequest(data: { requester: Creep, source: Structure, priority: string, resourceType: ResourceConstant }): void {
        // 如果当前空闲，可以接受任务
        if (this.creepMemory.state === 'idle' || this.creepMemory.state === 'seeking_task') {
            // 检查距离，只接受同房间或附近的任务
            if (data.source.room.name === this.creep.room.name) {
                const deliveryTarget = this.findDeliveryTarget();
                if (deliveryTarget) {
                    const task: HaulerTask = {
                        id: `task_${Game.time}_${Math.random()}`,
                        from: data.source.id,
                        to: deliveryTarget.id,
                        resourceType: data.resourceType,
                        priority: data.priority as any,
                        createdTime: Game.time,
                        assignedCreep: this.creep.name
                    };
                    
                    this.assignTask(task);
                }
            }
        }
    }

    /**
     * 获取搬运效率
     */
    public getHaulingCapacity(): number {
        return this.creep.store.getCapacity();
    }

    /**
     * 检查是否过载
     */
    public isOverloaded(): boolean {
        return this.creep.store.getFreeCapacity() === 0;
    }

    /**
     * 获取当前负载率
     */
    public getLoadRatio(): number {
        return this.creep.store.getUsedCapacity() / this.creep.store.getCapacity();
    }

    /**
     * 运行Hauler逻辑
     */
    public run(): void {
        super.run();
        
        // 检测卡住情况
        if (this.creepMemory.state === 'picking_up' || this.creepMemory.state === 'delivering') {
            // 如果长时间没有进展，重置任务
            const lastActionTime = this.creepMemory.lastAction ? parseInt(this.creepMemory.lastAction) : 0;
            if (!this.creepMemory.lastAction || Game.time - lastActionTime > 50) {
                this.emitSignal('hauler.stuck', {
                    creep: this.creep,
                    state: this.creepMemory.state,
                    task: this.creepMemory.currentTask
                });
                this.completeCurrentTask();
            }
        }
        
        // 更新最后活动时间
        this.updateMemory({ lastAction: Game.time.toString() });
    }
} 
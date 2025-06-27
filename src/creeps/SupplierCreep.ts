/**
 * 供给者Creep类 - 直接继承BaseCreep，专门为spawn和扩展充能
 */
import { BaseCreep, BaseCreepMemory } from './BaseCreep';
import { signal } from '../SignalSystem';

// Supplier内存接口
export interface SupplierCreepMemory extends BaseCreepMemory {
    role: 'supplier';
    // 搬运相关属性
    pickupTarget?: Id<Structure | Source>;
    deliveryTarget?: Id<Structure>;
    resourceType?: ResourceConstant;
    // Supplier特有属性
    preferredSource?: Id<Structure | Source>;
    energyTargets?: Id<Structure>[];
}

export class SupplierCreep extends BaseCreep {
    protected creepMemory: SupplierCreepMemory;

    constructor(creep: Creep) {
        super(creep);
        
        // 定义Supplier特有信号
        this.defineSignal('supplier.spawn_supplied');
        this.defineSignal('supplier.extension_supplied');
        this.defineSignal('supplier.energy_crisis');
        this.defineSignal('supplier.supply_complete');

        // 初始化Supplier内存
        this.creepMemory = this.creepMemory as SupplierCreepMemory;
        this.creepMemory.role = 'supplier';
        
        // 自动连接信号
        this.autoConnectSignals();
    }

    /**
     * 寻找优先交付目标（重写父类方法）
     */
    public findDeliveryTarget(): Structure | null {
        // 优先级: spawn > extension > tower
        
        // 1. 优先供给spawn
        const spawns = this.creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => {
                return structure.structureType === STRUCTURE_SPAWN &&
                       structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
            }
        }) as StructureSpawn[];

        if (spawns.length > 0) {
            const spawn = this.creep.pos.findClosestByPath(spawns);
            if (spawn) return spawn;
        }

        // 2. 其次供给extension
        const extensions = this.creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => {
                return structure.structureType === STRUCTURE_EXTENSION &&
                       structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
            }
        }) as StructureExtension[];

        if (extensions.length > 0) {
            // 按距离排序，优先供给最近的
            const extension = this.creep.pos.findClosestByPath(extensions);
            if (extension) return extension;
        }

        // 3. 如果spawn和extension都满了，供给tower
        const towers = this.creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => {
                return structure.structureType === STRUCTURE_TOWER &&
                       structure.store.getFreeCapacity(RESOURCE_ENERGY) > 100; // 只有需要较多能量时才供给
            }
        }) as StructureTower[];

        if (towers.length > 0) {
            const tower = this.creep.pos.findClosestByPath(towers);
            if (tower) return tower;
        }

        return null;
    }

    /**
     * 寻找最佳能量来源
     */
    public findBestEnergySource(): Structure | Source | null {
        // 优先从容器获取能量
        const containers = this.creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => {
                return structure.structureType === STRUCTURE_CONTAINER &&
                       structure.store.energy > 0;
            }
        }) as StructureContainer[];

        if (containers.length > 0) {
            // 按能量数量排序，优先选择能量多的
            containers.sort((a, b) => b.store.energy - a.store.energy);
            return containers[0];
        }

        // 其次从存储获取
        const storage = this.creep.room.find(FIND_STRUCTURES, {
            filter: (structure) => {
                return structure.structureType === STRUCTURE_STORAGE &&
                       structure.store.energy > 0;
            }
        })[0] as StructureStorage;

        if (storage) return storage;

        // 最后从source直接采集（紧急情况）
        const sources = this.creep.room.find(FIND_SOURCES, {
            filter: (source) => source.energy > 0
        });

        if (sources.length > 0) {
            return this.creep.pos.findClosestByPath(sources);
        }

        return null;
    }

    /**
     * 重写拾取目标查找（专门为spawn/extension服务）
     */
    public findPickupTarget(): Structure | Source | null {
        return this.findBestEnergySource();
    }

    /**
     * 检查能量危机
     */
    private checkEnergyCrisis(): void {
        const room = this.creep.room;
        const energyAvailable = room.energyAvailable;
        const energyCapacity = room.energyCapacityAvailable;
        
        // 如果可用能量低于20%，触发能量危机信号
        if (energyAvailable < energyCapacity * 0.2) {
            this.emitSignal('supplier.energy_crisis', {
                creep: this.creep,
                roomName: room.name,
                energyAvailable,
                energyCapacity,
                crisisLevel: 'critical'
            });
        } else if (energyAvailable < energyCapacity * 0.5) {
            this.emitSignal('supplier.energy_crisis', {
                creep: this.creep,
                roomName: room.name,
                energyAvailable,
                energyCapacity,
                crisisLevel: 'warning'
            });
        }
    }

    /**
     * 获取房间能量需求
     */
    public getRoomEnergyDemand(): number {
        const room = this.creep.room;
        return room.energyCapacityAvailable - room.energyAvailable;
    }

    /**
     * 检查是否需要紧急供给
     */
    public needsUrgentSupply(): boolean {
        const room = this.creep.room;
        const energyRatio = room.energyAvailable / room.energyCapacityAvailable;
        
        // 如果房间能量低于30%，需要紧急供给
        return energyRatio < 0.3;
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
        
        // 处理Source类型
        if (target instanceof Source) {
            const result = this.creep.harvest(target);
            if (result === OK) {
                this.say('⛏️采集中');
                return true;
            } else if (result === ERR_NOT_IN_RANGE) {
                this.moveTo(target);
                return true;
            }
            return false;
        }
        
        // 处理Structure类型
        if (!('store' in target) || !target.store || (target.store as any)[resourceType] === 0) {
            this.say('❌无资源');
            this.creepMemory.pickupTarget = undefined;
            return false;
        }

        const result = this.creep.withdraw(target as any, resourceType);
        
        if (result === OK) {
            this.say('📥拾取中');
            return true;
        } else if (result === ERR_NOT_IN_RANGE) {
            this.moveTo(target);
            return true;
        } else if (result === ERR_FULL) {
            this.creepMemory.pickupTarget = undefined;
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
            this.creepMemory.deliveryTarget = undefined;
            return false;
        }

        const result = this.creep.transfer(target as any, resourceType);
        
        if (result === OK) {
            this.say('📤交付中');
            
            // 发射特定的供给信号
            if (target.structureType === STRUCTURE_SPAWN) {
                this.emitSignal('supplier.spawn_supplied', {
                    creep: this.creep,
                    spawn: target,
                    amount: this.creep.store[resourceType]
                });
            } else if (target.structureType === STRUCTURE_EXTENSION) {
                this.emitSignal('supplier.extension_supplied', {
                    creep: this.creep,
                    extension: target,
                    amount: this.creep.store[resourceType]
                });
            }
            
            // 检查是否交付完毕
            if (this.creep.store[resourceType] === 0) {
                this.creepMemory.deliveryTarget = undefined;
            }
            
            return true;
        } else if (result === ERR_NOT_IN_RANGE) {
            this.moveTo(target);
            return true;
        } else if (result === ERR_FULL) {
            this.say('❌目标满了');
            this.creepMemory.deliveryTarget = undefined;
            return false;
        }
        
        return false;
    }

    /**
     * 完成供给任务
     */
    private completeSupply(): void {
        this.emitSignal('supplier.supply_complete', {
            creep: this.creep,
            roomName: this.creep.room.name,
            energySupplied: this.creep.store.getCapacity() - this.creep.store.getFreeCapacity()
        });
    }

    /**
     * 重写主要工作逻辑
     */
    protected doWork(): void {
        // 定期检查能量危机
        if (Game.time % 10 === 0) {
            this.checkEnergyCrisis();
        }

        // 如果房间需要紧急供给，设置高优先级
        if (this.needsUrgentSupply()) {
            this.say('🚨紧急!');
        }

        // 如果当前没有任务且房间需要能量，创建供给任务
        if (!this.creepMemory.currentTask && this.getRoomEnergyDemand() > 0) {
            const source = this.findPickupTarget();
            const target = this.findDeliveryTarget();
            
            if (source && target) {
                // 创建内部供给任务
                this.creepMemory.pickupTarget = source.id;
                this.creepMemory.deliveryTarget = target.id;
                this.creepMemory.resourceType = RESOURCE_ENERGY;
                this.setState('picking_up');
            } else if (!target) {
                // 没有需要供给的目标，完成供给
                this.completeSupply();
                this.setState('idle');
                this.say('✅供给完成');
                return;
            }
        }

        // 调用父类的工作逻辑
        super.doWork();
    }

    /**
     * 信号监听器：spawn能量不足
     */
    @signal('spawn.energy_low', 20)
    protected onSpawnEnergyLow(data: { spawn: StructureSpawn, energyLevel: number }): void {
        // 如果当前空闲，立即去供给spawn
        if (this.creepMemory.state === 'idle' || this.creepMemory.state === 'seeking_task') {
            const source = this.findPickupTarget();
            if (source) {
                this.creepMemory.pickupTarget = source.id;
                this.creepMemory.deliveryTarget = data.spawn.id;
                this.creepMemory.resourceType = RESOURCE_ENERGY;
                this.setState('picking_up');
                this.say('🏃‍♂️急救spawn');
            }
        }
    }

    /**
     * 信号监听器：房间能量危机
     */
    @signal('room.energy_crisis', 15)
    protected onRoomEnergyCrisis(data: { roomName: string, energyAvailable: number, energyCapacity: number }): void {
        if (data.roomName === this.creep.room.name) {
            // 优先处理spawn和extension
            const urgentTarget = this.findDeliveryTarget();
            if (urgentTarget && !this.creepMemory.currentTask) {
                const source = this.findPickupTarget();
                if (source) {
                    this.creepMemory.pickupTarget = source.id;
                    this.creepMemory.deliveryTarget = urgentTarget.id;
                    this.creepMemory.resourceType = RESOURCE_ENERGY;
                    this.setState('picking_up');
                    this.say('⚡危机模式');
                }
            }
        }
    }

    /**
     * 获取搬运容量
     */
    public getHaulingCapacity(): number {
        return this.creep.store.getCapacity();
    }

    /**
     * 获取供给效率
     */
    public getSupplyEfficiency(): number {
        const room = this.creep.room;
        const capacity = this.getHaulingCapacity();
        const demand = this.getRoomEnergyDemand();
        
        return Math.min(capacity, demand);
    }

    /**
     * 检查是否是主要供给者
     */
    public isPrimarySupplier(): boolean {
        const suppliers = Object.values(Game.creeps).filter(creep => 
            creep.memory.role === 'supplier' && 
            creep.room.name === this.creep.room.name
        );
        
        // 如果是唯一的supplier或者是第一个supplier
        return suppliers.length === 1 || suppliers[0].name === this.creep.name;
    }

    /**
     * 运行Supplier逻辑
     */
    public run(): void {
        super.run();
        
        // 如果是主要供给者，定期检查整个房间的能量状况
        if (this.isPrimarySupplier() && Game.time % 5 === 0) {
            const room = this.creep.room;
            const energyRatio = room.energyAvailable / room.energyCapacityAvailable;
            
            if (energyRatio >= 1.0) {
                this.emitSignal('supplier.supply_complete', {
                    creep: this.creep,
                    roomName: room.name,
                    energySupplied: room.energyAvailable
                });
            }
        }
    }
} 
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
     * 寻找优先交付目标（优化版本）
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
            const spawn = this.creep.pos.findClosestByRange(spawns); // 使用Range而不是Path
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
            const extension = this.creep.pos.findClosestByRange(extensions); // 使用Range而不是Path
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
            const tower = this.creep.pos.findClosestByRange(towers); // 使用Range而不是Path
            if (tower) return tower;
        }

        return null;
    }

    /**
     * 寻找最佳能量来源（优化版本）
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
            return this.creep.pos.findClosestByRange(sources); // 使用Range而不是Path
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
     * 检查能量危机（防重复发射）
     */
    private checkEnergyCrisis(): void {
        // 只有主要供给者才检查能量危机，避免重复信号
        if (!this.isPrimarySupplier()) return;
        
        const room = this.creep.room;
        const energyAvailable = room.energyAvailable;
        const energyCapacity = room.energyCapacityAvailable;
        const energyRatio = energyAvailable / energyCapacity;
        
        // 使用Memory缓存上次危机状态，避免重复发射
        const roomMemory = room.memory as any;
        if (!roomMemory.lastEnergyCrisisCheck) {
            roomMemory.lastEnergyCrisisCheck = {
                tick: Game.time,
                level: 'normal'
            };
        }
        
        const lastCheck = roomMemory.lastEnergyCrisisCheck;
        let currentLevel = 'normal';
        
        if (energyRatio < 0.2) {
            currentLevel = 'critical';
        } else if (energyRatio < 0.5) {
            currentLevel = 'warning';
        }
        
        // 只有危机级别变化或者距离上次检查超过50tick才发射信号
        if (currentLevel !== lastCheck.level || Game.time - lastCheck.tick > 50) {
            if (currentLevel !== 'normal') {
                this.emitSignal('supplier.energy_crisis', {
                    creep: this.creep,
                    roomName: room.name,
                    energyAvailable,
                    energyCapacity,
                    crisisLevel: currentLevel,
                    energyRatio: Math.round(energyRatio * 100)
                });
            }
            
            // 更新检查记录
            lastCheck.tick = Game.time;
            lastCheck.level = currentLevel;
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

        const target = this.safeGetObjectById(this.creepMemory.pickupTarget);
        if (!target) {
            this.creepMemory.pickupTarget = undefined;
            return false;
        }

        const resourceType = this.creepMemory.resourceType || RESOURCE_ENERGY;
        
        // 处理Source类型
        if (target instanceof Source) {
            const result = this.creep.harvest(target);
            if (result === OK) {
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

        const target = this.safeGetObjectById(this.creepMemory.deliveryTarget);
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
     * 重写主要工作逻辑（优化版本）
     */
    protected doWork(): void {
        // 定期检查能量危机
        if (Game.time % 10 === 0) {
            this.checkEnergyCrisis();
        }

        // 检查当前目标是否仍然有效
        this.validateCurrentTargets();

        // 状态切换逻辑：如果正在交付但没有资源，切换到拾取
        if (this.creepMemory.state === 'delivering' && this.creep.store.energy === 0) {
            this.setState('picking_up');
            this.say('📥去拾取');
            // 不立即清空deliveryTarget，让它在下次交付时重用（如果仍然有效）
        }
        // 状态切换逻辑：如果正在拾取但满载，切换到交付
        else if (this.creepMemory.state === 'picking_up' && this.creep.store.getFreeCapacity() === 0) {
            this.setState('delivering');
            this.say('📤去交付');
            // 不立即清空pickupTarget，让它在下次拾取时重用（如果仍然有效）
        }
        // 初始状态：如果没有状态，根据能量情况设置初始状态
        else if (!this.creepMemory.state || this.creepMemory.state === 'idle') {
            if (this.getRoomEnergyDemand() === 0) {
                // 没有需要供给的目标，完成供给
                this.completeSupply();
                this.setState('idle');
                this.say('✅供给完成');
                return;
            } else if (this.creep.store.energy === 0) {
                this.setState('picking_up');
            } else {
                this.setState('delivering');
            }
        }

        // 根据当前状态执行对应任务
        if (this.creepMemory.state === 'picking_up') {
            // 验证并获取拾取目标
            if (!this.hasValidPickupTarget()) {
                const source = this.findPickupTarget();
                if (source) {
                    this.creepMemory.pickupTarget = source.id;
                    this.creepMemory.resourceType = RESOURCE_ENERGY;
                } else {
                    this.say('❓找不到能量源');
                    return;
                }
            }
            
            if (!this.doPickup()) {
                // 如果拾取失败，清空目标重新寻找
                this.creepMemory.pickupTarget = undefined;
            }
        } else if (this.creepMemory.state === 'delivering') {
            // 验证并获取交付目标
            if (!this.hasValidDeliveryTarget()) {
                const target = this.findDeliveryTarget();
                if (target) {
                    this.creepMemory.deliveryTarget = target.id;
                    this.creepMemory.resourceType = RESOURCE_ENERGY;
                } else {
                    this.say('❓找不到交付目标');
                    return;
                }
            }
            
            if (!this.doDelivery()) {
                // 如果交付失败，清空目标重新寻找
                this.creepMemory.deliveryTarget = undefined;
            }
        }
    }

    /**
     * 验证当前目标是否有效
     */
    private validateCurrentTargets(): void {
        // 验证拾取目标
        if (this.creepMemory.pickupTarget) {
            const target = this.safeGetObjectById(this.creepMemory.pickupTarget);
            if (!target || (target instanceof Source && target.energy === 0) || 
                ('store' in target && target.store && (target.store as any).energy === 0)) {
                this.creepMemory.pickupTarget = undefined;
            }
        }

        // 验证交付目标
        if (this.creepMemory.deliveryTarget) {
            const target = this.safeGetObjectById(this.creepMemory.deliveryTarget);
            if (!target || ('store' in target && target.store && 
                (target.store as any).getFreeCapacity(RESOURCE_ENERGY) === 0)) {
                this.creepMemory.deliveryTarget = undefined;
            }
        }
    }

    /**
     * 检查是否有有效的拾取目标
     */
    private hasValidPickupTarget(): boolean {
        if (!this.creepMemory.pickupTarget) return false;
        
        const target = this.safeGetObjectById(this.creepMemory.pickupTarget);
        if (!target) return false;
        
        if (target instanceof Source) {
            return target.energy > 0;
        } else if ('store' in target && target.store) {
            return (target.store as any).energy > 0;
        }
        
        return false;
    }

    /**
     * 检查是否有有效的交付目标
     */
    private hasValidDeliveryTarget(): boolean {
        if (!this.creepMemory.deliveryTarget) return false;
        
        const target = this.safeGetObjectById(this.creepMemory.deliveryTarget);
        if (!target || !('store' in target) || !target.store) return false;
        
        return (target.store as any).getFreeCapacity(RESOURCE_ENERGY) > 0;
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
/**
 * 矿工Creep类 - 专门负责采集资源并放入容器
 */
import { BaseCreep, BaseCreepMemory } from './BaseCreep';
import { signal } from '../SignalSystem';

// Miner内存接口
export interface MinerCreepMemory extends BaseCreepMemory {
    role: 'miner';
    sourceId?: Id<Source>;
    containerId?: Id<StructureContainer>;
    containerPos?: RoomPosition;
    miningPosition?: RoomPosition;
}

export class MinerCreep extends BaseCreep {
    protected creepMemory: MinerCreepMemory;

    constructor(creep: Creep) {
        super(creep);
        
        // 定义Miner特有信号
        this.defineSignal('miner.source_assigned');
        this.defineSignal('miner.started_mining');
        this.defineSignal('miner.container_full');
        this.defineSignal('miner.container_needed');
        this.defineSignal('miner.source_depleted');
        this.defineSignal('miner.at_mining_position');

        // 初始化Miner内存
        this.creepMemory = this.creepMemory as MinerCreepMemory;
        this.creepMemory.role = 'miner';
        
        // 自动连接信号
        this.autoConnectSignals();
    }

    /**
     * 获取分配的资源点
     */
    public getAssignedSource(): Source | null {
        if (this.creepMemory.sourceId) {
            const source = Game.getObjectById(this.creepMemory.sourceId);
            if (source) return source;
        }
        return null;
    }

    /**
     * 分配资源点
     */
    public assignSource(source: Source): void {
        this.creepMemory.sourceId = source.id;
        this.emitSignal('miner.source_assigned', {
            creep: this.creep,
            source: source
        });
        
        // 寻找或建议建造容器
        this.setupContainer();
    }

    /**
     * 寻找最近的未分配资源点
     */
    public findUnassignedSource(): Source | null {
        const sources = this.creep.room.find(FIND_SOURCES);
        
        // 寻找没有其他miner分配的source
        for (const source of sources) {
            const assignedMiners = Object.values(Game.creeps).filter(creep => {
                if (creep.memory.role !== 'miner' || creep.name === this.creep.name) return false;
                const minerMemory = creep.memory as MinerCreepMemory;
                return minerMemory.sourceId === source.id;
            });
            
            if (assignedMiners.length === 0) {
                return source;
            }
        }
        
        return null;
    }

    /**
     * 设置容器
     */
    private setupContainer(): void {
        const source = this.getAssignedSource();
        if (!source) return;

        // 寻找source附近的容器
        const nearbyContainers = source.pos.findInRange(FIND_STRUCTURES, 2, {
            filter: (structure) => structure.structureType === STRUCTURE_CONTAINER
        }) as StructureContainer[];

        if (nearbyContainers.length > 0) {
            this.creepMemory.containerId = nearbyContainers[0].id;
            this.creepMemory.containerPos = nearbyContainers[0].pos;
            this.creepMemory.miningPosition = nearbyContainers[0].pos;
        } else {
            // 没有容器，建议建造一个
            this.suggestContainer();
        }
    }

    /**
     * 建议建造容器
     */
    private suggestContainer(): void {
        const source = this.getAssignedSource();
        if (!source) return;

        // 寻找source附近合适的位置
        const positions: RoomPosition[] = [];
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;
                const x = source.pos.x + dx;
                const y = source.pos.y + dy;
                if (x >= 0 && x < 50 && y >= 0 && y < 50) {
                    const pos = new RoomPosition(x, y, source.room.name);
                    const terrain = this.creep.room.getTerrain();
                    if (terrain.get(pos.x, pos.y) !== TERRAIN_MASK_WALL) {
                        positions.push(pos);
                    }
                }
            }
        }

        if (positions.length > 0) {
            const bestPos = positions[0]; // 可以优化选择逻辑
            this.creepMemory.containerPos = bestPos;
            this.creepMemory.miningPosition = bestPos;
            
            this.emitSignal('miner.container_needed', {
                creep: this.creep,
                source: source,
                suggestedPos: bestPos
            });
        }
    }

    /**
     * 获取容器
     */
    public getContainer(): StructureContainer | null {
        if (this.creepMemory.containerId) {
            const container = Game.getObjectById(this.creepMemory.containerId);
            if (container) return container;
            this.creepMemory.containerId = undefined;
        }

        // 重新寻找容器
        const source = this.getAssignedSource();
        if (source) {
            this.setupContainer();
            if (this.creepMemory.containerId) {
                return Game.getObjectById(this.creepMemory.containerId);
            }
        }

        return null;
    }

    /**
     * 执行挖矿
     */
    public doMining(): boolean {
        const source = this.getAssignedSource();
        if (!source) return false;

        // 检查source是否还有能量
        if (source.energy === 0) {
            this.emitSignal('miner.source_depleted', {
                creep: this.creep,
                source: source,
                regenTime: source.ticksToRegeneration
            });
            this.say(`💤${source.ticksToRegeneration || '?'}`);
            return false;
        }

        const result = this.creep.harvest(source);
        
        if (result === OK) {
            this.say('⛏️挖矿中');
            
            // 检查容器是否满了
            const container = this.getContainer();
            if (container && container.store.getFreeCapacity() === 0) {
                this.emitSignal('miner.container_full', {
                    creep: this.creep,
                    container: container,
                    source: source
                });
            }
            
            return true;
        } else if (result === ERR_NOT_IN_RANGE) {
            this.moveToMiningPosition();
            return true;
        }
        
        return false;
    }

    /**
     * 移动到挖矿位置
     */
    public moveToMiningPosition(): void {
        if (this.creepMemory.miningPosition) {
            this.moveTo(this.creepMemory.miningPosition);
        } else {
            const source = this.getAssignedSource();
            if (source) {
                this.moveTo(source);
            }
        }
    }

    /**
     * 检查是否在挖矿位置
     */
    public isAtMiningPosition(): boolean {
        if (this.creepMemory.miningPosition) {
            return this.creep.pos.isEqualTo(this.creepMemory.miningPosition);
        }
        
        const source = this.getAssignedSource();
        if (source) {
            return this.creep.pos.inRangeTo(source, 1);
        }
        
        return false;
    }

    /**
     * 转移资源到容器
     */
    public transferToContainer(): boolean {
        const container = this.getContainer();
        if (!container) return false;

        if (this.creep.store.energy === 0) return false;

        const result = this.creep.transfer(container, RESOURCE_ENERGY);
        
        if (result === OK) {
            this.say('📦存储中');
            return true;
        } else if (result === ERR_NOT_IN_RANGE) {
            this.moveTo(container);
            return true;
        } else if (result === ERR_FULL) {
            this.emitSignal('miner.container_full', {
                creep: this.creep,
                container: container,
                source: this.getAssignedSource()
            });
            return false;
        }
        
        return false;
    }

    /**
     * 主要工作逻辑
     */
    protected doWork(): void {
        // 如果没有分配source，尝试分配一个
        if (!this.getAssignedSource()) {
            const source = this.findUnassignedSource();
            if (source) {
                this.assignSource(source);
                this.setState('assigned');
            } else {
                this.say('❓无源点');
                return;
            }
        }

        // 如果creep满载，先转移到容器
        if (this.creep.store.energy === this.creep.store.getCapacity()) {
            if (this.creepMemory.state !== 'transferring') {
                this.setState('transferring');
            }
            this.transferToContainer();
            return;
        }

        // 开始挖矿
        if (this.creepMemory.state !== 'mining') {
            this.setState('mining');
            this.emitSignal('miner.started_mining', {
                creep: this.creep,
                source: this.getAssignedSource()
            });
        }

        // 移动到挖矿位置
        if (!this.isAtMiningPosition()) {
            this.moveToMiningPosition();
            return;
        }

        // 在位置上发射信号
        if (this.isAtMiningPosition()) {
            this.emitSignal('miner.at_mining_position', {
                creep: this.creep,
                position: this.creep.pos,
                source: this.getAssignedSource()
            });
        }

        // 执行挖矿
        this.doMining();
    }

    /**
     * 信号监听器：容器建造完成
     */
    @signal('building.construction_completed', 15)
    protected onConstructionCompleted(data: any): void {
        // 检查是否是我们建议的容器
        if (data.plan && data.plan.structureType === STRUCTURE_CONTAINER) {
            const myPos = this.creepMemory.containerPos;
            if (myPos && data.plan.pos.x === myPos.x && data.plan.pos.y === myPos.y) {
                // 重新设置容器
                this.setupContainer();
                this.say('📦容器就绪!');
            }
        }
    }

    /**
     * 信号监听器：源点分配
     */
    @signal('mining.source_assigned', 20)
    protected onSourceAssigned(data: { creep: Creep, source: Source }): void {
        if (data.creep === this.creep) {
            this.assignSource(data.source);
            this.setState('assigned');
            this.say('🎯获得源点');
        }
    }

    /**
     * 获取挖矿效率
     */
    public getMiningEfficiency(): number {
        const workParts = this.creep.body.filter(part => part.type === WORK).length;
        return workParts * 2; // 每个WORK部件每tick产生2能量
    }

    /**
     * 获取容器使用率
     */
    public getContainerUsage(): number {
        const container = this.getContainer();
        if (!container) return 0;
        
        return container.store.energy / container.store.getCapacity();
    }

    /**
     * 检查是否需要hauler
     */
    public needsHauler(): boolean {
        const container = this.getContainer();
        if (!container) return false;
        
        return this.getContainerUsage() > 0.8; // 容器使用率超过80%
    }

    /**
     * 运行Miner逻辑
     */
    public run(): void {
        super.run();
        
        // 定期检查是否需要hauler
        if (Game.time % 10 === 0 && this.needsHauler()) {
            this.emitSignal('hauler.request', {
                requester: this.creep,
                source: this.getContainer(),
                priority: 'normal',
                resourceType: RESOURCE_ENERGY
            });
        }
    }
} 
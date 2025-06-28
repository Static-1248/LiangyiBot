/**
 * 基础Creep类 - 所有creep的基类
 */
import { SignalEmitter, signal } from '../SignalSystem';
import { memory } from '../MemoryManager';

// Creep内存接口
export interface BaseCreepMemory {
    role: string;
    state: string;
    target?: Id<any>;
    targetPos?: RoomPosition;
    task?: string;
    lastAction?: string;
    born: number;
    [key: string]: any;
}

export class BaseCreep extends SignalEmitter {
    protected creep: Creep;
    protected creepMemory: BaseCreepMemory;

    constructor(creep: Creep) {
        super();
        this.creep = creep;
        
        // 定义基础信号
        this.defineSignal('creep.spawned');
        this.defineSignal('creep.moved');
        this.defineSignal('creep.arrived');
        this.defineSignal('creep.stuck');
        this.defineSignal('creep.energy_full');
        this.defineSignal('creep.energy_empty');
        this.defineSignal('creep.task_started');
        this.defineSignal('creep.task_completed');
        this.defineSignal('creep.state_changed');
        this.defineSignal('creep.died');

        // 获取或初始化内存
        this.creepMemory = memory.getCreepMemory(creep.name, {
            role: 'base',
            state: 'idle',
            born: Game.time
        });

        // 自动连接信号
        this.autoConnectSignals();
    }

    /**
     * 获取creep实例
     */
    public getCreep(): Creep {
        return this.creep;
    }

    /**
     * 获取creep内存
     */
    public getMemory(): BaseCreepMemory {
        return this.creepMemory;
    }

    /**
     * 更新creep内存
     */
    public updateMemory(updates: Partial<BaseCreepMemory>): void {
        Object.assign(this.creepMemory, updates);
        memory.setCreepMemory(this.creep.name, this.creepMemory);
    }

    /**
     * 改变状态
     */
    public setState(newState: string): void {
        const oldState = this.creepMemory.state;
        if (oldState !== newState) {
            this.creepMemory.state = newState;
            this.updateMemory({ state: newState });
            this.emitSignal('creep.state_changed', {
                creep: this.creep,
                oldState,
                newState
            });
        }
    }

    /**
     * 设置任务
     */
    public setTask(task: string): void {
        this.updateMemory({ task });
        this.emitSignal('creep.task_started', {
            creep: this.creep,
            task
        });
    }

    /**
     * 完成任务
     */
    public completeTask(): void {
        const task = this.creepMemory.task;
        this.updateMemory({ task: undefined });
        this.emitSignal('creep.task_completed', {
            creep: this.creep,
            task
        });
    }

    /**
     * 移动到目标位置
     * @param target 目标位置或对象
     * @param opts 移动选项
     */
    public moveTo(target: RoomPosition | RoomObject, opts?: MoveToOpts): ScreepsReturnCode {
        const result = this.creep.moveTo(target, opts);
        
        if (result === OK) {
            this.emitSignal('creep.moved', {
                creep: this.creep,
                target,
                result
            });
            
            // 检查是否到达目标
            const targetPos = target instanceof RoomObject ? target.pos : target;
            if (this.creep.pos.isEqualTo(targetPos)) {
                this.emitSignal('creep.arrived', {
                    creep: this.creep,
                    target,
                    position: targetPos
                });
            }
        } else if (result === ERR_NO_PATH) {
            this.emitSignal('creep.stuck', {
                creep: this.creep,
                target,
                reason: 'no_path'
            });
        }

        return result;
    }

    /**
     * 寻找最近的目标
     * @param findType 查找类型
     * @param filter 过滤条件
     */
    public findClosest<T extends FindConstant>(
        findType: T, 
        filter?: (object: FindTypes[T]) => boolean
    ): FindTypes[T] | null {
        const targets = this.creep.room.find(findType, filter ? { filter } : undefined);
        return this.creep.pos.findClosestByPath(targets);
    }

    /**
     * 安全地通过ID获取对象，处理可能的失效ID
     * @param id 对象ID
     * @returns 对象实例或null
     */
    protected safeGetObjectById<T extends _HasId>(id: Id<T> | undefined): T | null {
        if (!id) return null;
        
        try {
            return Game.getObjectById(id);
        } catch (error) {
            console.log(`[BaseCreep] ${this.creep.name} 无法找到对象 ID: ${id}`);
            return null;
        }
    }

    /**
     * 检查能量状态
     */
    public checkEnergyStatus(): void {
        // 如果creep即将死亡或已经死亡，不检查能量状态
        if (!this.creep || this.creep.ticksToLive === 0) {
            return;
        }
        
        try {
            const energyRatio = this.creep.store.energy / this.creep.store.getCapacity(RESOURCE_ENERGY);
            
            if (energyRatio >= 1.0 && this.creepMemory.lastAction !== 'energy_full') {
                this.updateMemory({ lastAction: 'energy_full' });
                this.emitSignal('creep.energy_full', {
                    creep: this.creep,
                    energy: this.creep.store.energy
                });
            } else if (energyRatio <= 0 && this.creepMemory.lastAction !== 'energy_empty') {
                this.updateMemory({ lastAction: 'energy_empty' });
                this.emitSignal('creep.energy_empty', {
                    creep: this.creep,
                    capacity: this.creep.store.getCapacity(RESOURCE_ENERGY)
                });
            }
        } catch (error) {
            console.log(`[BaseCreep] ${this.creep.name} checkEnergyStatus error:`, error);
        }
    }

    /**
     * 说话
     */
    public say(message: string, sayPublic?: boolean): ScreepsReturnCode {
        return this.creep.say(message, sayPublic);
    }

    /**
     * 获取年龄
     */
    public getAge(): number {
        return Game.time - this.creepMemory.born;
    }

    /**
     * 检查是否接近死亡
     */
    public isNearDeath(): boolean {
        return this.creep.ticksToLive !== undefined && this.creep.ticksToLive < 50;
    }

    /**
     * 信号监听器：移动完成
     */
    @signal('creep.arrived', 10)
    protected onArrived(data: any): void {
        // 子类可以重写此方法
        console.log(`${this.creep.name} 到达目标位置`);
    }

    /**
     * 信号监听器：能量满了
     */
    @signal('creep.energy_full', 10)
    protected onEnergyFull(data: any): void {
        // 子类可以重写此方法
        // 移除默认说话，让子类决定
    }

    /**
     * 信号监听器：能量空了
     */
    @signal('creep.energy_empty', 10)
    protected onEnergyEmpty(data: any): void {
        // 子类可以重写此方法
        // 移除默认说话，让子类决定
    }

    /**
     * 主要运行逻辑
     */
    public run(): void {
        this.checkEnergyStatus();
        this.doWork();
    }

    /**
     * 具体工作逻辑 - 子类需要实现
     */
    protected doWork(): void {
        // 基类默认空实现
    }

    /**
     * 死亡处理
     */
    public onDeath(): void {
        this.emitSignal('creep.died', {
            creep: this.creep,
            age: this.getAge(),
            role: this.creepMemory.role
        });
        
        // 清除内存
        memory.clearCreepMemory(this.creep.name);
    }
} 
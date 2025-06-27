/**
 * 内存管理器 - 处理creep内存、GC、定时事件等
 */
import { SignalEmitter, signals } from './SignalSystem';

// 定时事件接口
export interface TimedEvent {
    id: string;
    signal: string;
    data?: any;
    scheduledTime: number;
    interval?: number; // 如果设置，表示循环事件
    maxExecutions?: number; // 最大执行次数
    executionCount: number;
}

// 内存GC标记接口
export interface GCMarker {
    path: string;
    expireTime: number;
    reason?: string;
}

export class MemoryManager extends SignalEmitter {
    private static instance: MemoryManager;
    private timedEvents: Map<string, TimedEvent> = new Map();
    private gcMarkers: GCMarker[] = [];

    private constructor() {
        super();
        this.defineSignal('memory.creep_memory_cleared');
        this.defineSignal('memory.gc_executed');
        this.defineSignal('memory.timed_event_triggered');
        this.defineSignal('memory.global_memory_updated');
    }

    public static getInstance(): MemoryManager {
        if (!MemoryManager.instance) {
            MemoryManager.instance = new MemoryManager();
        }
        return MemoryManager.instance;
    }

    /**
     * 获取creep内存，如果不存在则创建
     * @param creepName creep名称
     * @param defaultMemory 默认内存结构
     */
    public getCreepMemory<T = any>(creepName: string, defaultMemory: T = {} as T): T {
        if (!Memory.creeps[creepName]) {
            Memory.creeps[creepName] = defaultMemory as any;
        }
        return Memory.creeps[creepName] as T;
    }

    /**
     * 设置creep内存
     * @param creepName creep名称
     * @param memory 内存数据
     */
    public setCreepMemory<T = any>(creepName: string, memory: T): void {
        Memory.creeps[creepName] = memory as any;
    }

    /**
     * 更新creep内存的特定字段
     * @param creepName creep名称
     * @param updates 要更新的字段
     */
    public updateCreepMemory<T = any>(creepName: string, updates: Partial<T>): void {
        const current = this.getCreepMemory(creepName);
        Object.assign(current, updates);
    }

    /**
     * 清除creep内存
     * @param creepName creep名称
     */
    public clearCreepMemory(creepName: string): void {
        if (Memory.creeps[creepName]) {
            delete Memory.creeps[creepName];
            this.emitSignal('memory.creep_memory_cleared', { creepName });
        }
    }

    /**
     * 清除所有死亡creep的内存
     */
    public clearDeadCreepsMemory(): void {
        const clearedCreeps: string[] = [];
        
        for (const creepName in Memory.creeps) {
            if (!Game.creeps[creepName]) {
                delete Memory.creeps[creepName];
                clearedCreeps.push(creepName);
            }
        }

        if (clearedCreeps.length > 0) {
            this.emitSignal('memory.creep_memory_cleared', { 
                creepNames: clearedCreeps,
                count: clearedCreeps.length 
            });
        }
    }

    /**
     * 获取全局内存
     * @param path 内存路径，使用点分隔
     * @param defaultValue 默认值
     */
    public getGlobalMemory<T = any>(path: string, defaultValue?: T): T {
        const parts = path.split('.');
        let current: any = Memory;

        for (const part of parts) {
            if (current[part] === undefined) {
                if (defaultValue !== undefined) {
                    current[part] = defaultValue;
                    return defaultValue;
                }
                return undefined as any;
            }
            current = current[part];
        }

        return current;
    }

    /**
     * 设置全局内存
     * @param path 内存路径
     * @param value 值
     */
    public setGlobalMemory(path: string, value: any): void {
        const parts = path.split('.');
        let current: any = Memory;

        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (current[part] === undefined) {
                current[part] = {};
            }
            current = current[part];
        }

        const lastPart = parts[parts.length - 1];
        current[lastPart] = value;
        
        this.emitSignal('memory.global_memory_updated', { path, value });
    }

    /**
     * 删除全局内存
     * @param path 内存路径
     */
    public deleteGlobalMemory(path: string): void {
        const parts = path.split('.');
        let current: any = Memory;

        for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            if (current[part] === undefined) {
                return; // 路径不存在
            }
            current = current[part];
        }

        const lastPart = parts[parts.length - 1];
        if (current[lastPart] !== undefined) {
            delete current[lastPart];
            this.emitSignal('memory.global_memory_updated', { path, deleted: true });
        }
    }

    /**
     * 标记内存路径进行GC回收
     * @param path 内存路径
     * @param expireTime 过期时间（游戏tick）
     * @param reason 标记原因
     */
    public markForGC(path: string, expireTime: number, reason?: string): void {
        this.gcMarkers.push({
            path,
            expireTime,
            reason
        });
    }

    /**
     * 执行GC回收
     */
    public executeGC(): void {
        const currentTime = Game.time;
        const expiredMarkers: GCMarker[] = [];
        
        this.gcMarkers = this.gcMarkers.filter(marker => {
            if (marker.expireTime <= currentTime) {
                expiredMarkers.push(marker);
                this.deleteGlobalMemory(marker.path);
                return false;
            }
            return true;
        });

        if (expiredMarkers.length > 0) {
            this.emitSignal('memory.gc_executed', {
                clearedPaths: expiredMarkers.map(m => m.path),
                count: expiredMarkers.length,
                markers: expiredMarkers
            });
        }
    }

    /**
     * 添加定时事件
     * @param id 事件ID
     * @param signal 要发射的信号
     * @param delay 延迟时间（ticks）
     * @param data 事件数据
     * @param interval 循环间隔（可选）
     * @param maxExecutions 最大执行次数（可选）
     */
    public addTimedEvent(
        id: string, 
        signal: string, 
        delay: number, 
        data?: any, 
        interval?: number, 
        maxExecutions?: number
    ): void {
        const timedEvent: TimedEvent = {
            id,
            signal,
            data,
            scheduledTime: Game.time + delay,
            interval,
            maxExecutions,
            executionCount: 0
        };

        this.timedEvents.set(id, timedEvent);
    }

    /**
     * 移除定时事件
     * @param id 事件ID
     */
    public removeTimedEvent(id: string): void {
        this.timedEvents.delete(id);
    }

    /**
     * 处理定时事件
     */
    public processTimedEvents(): void {
        const currentTime = Game.time;
        const eventsToRemove: string[] = [];

        for (const [id, event] of this.timedEvents) {
            if (event.scheduledTime <= currentTime) {
                // 触发事件
                signals.emit(event.signal, Object.assign({}, event.data, {
                    timedEventId: id,
                    executionCount: event.executionCount + 1
                }));

                this.emitSignal('memory.timed_event_triggered', {
                    id: event.id,
                    signal: event.signal,
                    executionCount: event.executionCount + 1
                });

                event.executionCount++;

                // 检查是否需要重新安排或移除
                if (event.interval && (!event.maxExecutions || event.executionCount < event.maxExecutions)) {
                    // 重新安排循环事件
                    event.scheduledTime = currentTime + event.interval;
                } else {
                    // 移除一次性事件或已达到最大执行次数的事件
                    eventsToRemove.push(id);
                }
            }
        }

        // 移除已完成的事件
        eventsToRemove.forEach(id => this.timedEvents.delete(id));
    }

    /**
     * 获取定时事件列表
     */
    public getTimedEvents(): TimedEvent[] {
        return Array.from(this.timedEvents.values());
    }

    /**
     * 获取pending的GC标记
     */
    public getGCMarkers(): GCMarker[] {
        return this.gcMarkers.slice();
    }

    /**
     * 内存统计信息
     */
    public getMemoryStats(): any {
        // 直接估算内存使用量，避免JSON.stringify可能的问题
        const creepCount = Object.keys(Memory.creeps || {}).length;
        const timedEventCount = this.timedEvents.size;
        const gcMarkerCount = this.gcMarkers.length;
        
        // 粗略估算：每个creep约100字节内存
        const estimatedMemoryUsage = creepCount * 100 + timedEventCount * 50 + gcMarkerCount * 30;

        return {
            totalMemoryUsage: estimatedMemoryUsage,
            creepMemoryCount: creepCount,
            timedEventCount,
            gcMarkerCount,
            memoryPerCreep: creepCount > 0 ? Math.round(estimatedMemoryUsage / creepCount) : 0
        };
    }

    /**
     * 运行内存管理器的主要逻辑
     */
    public run(): void {
        this.clearDeadCreepsMemory();
        this.executeGC();
        this.processTimedEvents();
    }
}

// 全局内存管理器实例
export const memory = MemoryManager.getInstance(); 
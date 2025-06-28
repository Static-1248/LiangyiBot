/**
 * 信号系统 - 类似Godot的信号系统
 * 支持信号定义、连接、发射和断开连接
 */

// 信号接口定义
export interface Signal<T = any> {
    name: string;
    data?: T;
}

// 信号连接接口
export interface SignalConnection {
    signal: string;
    target: any;
    method: string | Function;
    oneShot?: boolean;
    priority?: number;
}

// 信号管理器
export class SignalManager {
    private static instance: SignalManager;
    private connections: Map<string, SignalConnection[]> = new Map();
    private signalHistory: Signal[] = [];
    private maxHistorySize = 1000;
    private debugMode = false;

    private constructor() {}

    public static getInstance(): SignalManager {
        if (!SignalManager.instance) {
            SignalManager.instance = new SignalManager();
        }
        return SignalManager.instance;
    }

    /**
     * 连接信号到目标方法
     * @param signal 信号名称
     * @param target 目标对象
     * @param method 方法名或函数
     * @param oneShot 是否为一次性连接
     * @param priority 优先级（数字越大优先级越高）
     */
    public connect(signal: string, target: any, method: string | Function, oneShot = false, priority = 0): void {
        if (!this.connections.has(signal)) {
            this.connections.set(signal, []);
        }

        const connection: SignalConnection = {
            signal,
            target,
            method,
            oneShot,
            priority
        };

        const connections = this.connections.get(signal)!;
        connections.push(connection);
        
        // 按优先级排序（高优先级在前）
        connections.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    }

    /**
     * 断开信号连接
     * @param signal 信号名称
     * @param target 目标对象（可选）
     * @param method 方法名（可选）
     */
    public disconnect(signal: string, target?: any, method?: string | Function): void {
        const connections = this.connections.get(signal);
        if (!connections) return;

        if (target === undefined && method === undefined) {
            // 断开所有连接
            this.connections.delete(signal);
        } else {
            // 断开特定连接
            const filtered = connections.filter(conn => {
                if (target && conn.target !== target) return true;
                if (method && conn.method !== method) return true;
                return false;
            });
            
            if (filtered.length === 0) {
                this.connections.delete(signal);
            } else {
                this.connections.set(signal, filtered);
            }
        }
    }

    /**
     * 发射信号
     * @param signal 信号名称
     * @param data 信号数据
     */
    public emit(signal: string, data?: any): void {
        const signalObj: Signal = { name: signal, data };
        
        // 记录信号历史
        this.signalHistory.push(signalObj);
        if (this.signalHistory.length > this.maxHistorySize) {
            this.signalHistory.shift();
        }

        const connections = this.connections.get(signal);
        if (!connections) {
            // 调试：显示没有监听器的信号
            if (this.debugMode) {
                console.log(`📡 信号 "${signal}" 发射但无监听器 [数据: ${data ? JSON.stringify(data).substring(0, 50) : 'none'}]`);
            }
            return;
        }

        // 调试：显示信号发射和监听器信息
        if (this.debugMode) {
            const senderInfo = this.getCallerInfo();
            console.log(`📡 [${Game.time}] 信号 "${signal}" 发射`);
            console.log(`   发射者: ${senderInfo}`);
            console.log(`   监听器数量: ${connections.length}`);
            if (data) {
                const dataStr = JSON.stringify(data).substring(0, 100);
                console.log(`   数据: ${dataStr}${dataStr.length >= 100 ? '...' : ''}`);
            }
        }

        // 复制连接数组，防止在执行过程中被修改
        const connectionsToExecute = connections.slice();
        const connectionsToRemove: SignalConnection[] = [];

        for (let i = 0; i < connectionsToExecute.length; i++) {
            const connection = connectionsToExecute[i];
            const startTime = Game.cpu.getUsed();
            
            try {
                if (this.debugMode) {
                    let targetName = 'null';
                    let methodName = 'function';
                    
                    try {
                        if (connection.target) {
                            targetName = connection.target.constructor?.name || 'unknown';
                        }
                        if (typeof connection.method === 'string') {
                            methodName = connection.method;
                        } else if (typeof connection.method === 'function') {
                            methodName = connection.method.name || 'anonymous';
                        }
                    } catch (e) {
                        targetName = 'error';
                    }
                    
                    console.log(`   → [${i + 1}] ${targetName}.${methodName} (优先级: ${connection.priority || 0})`);
                }

                if (typeof connection.method === 'function') {
                    connection.method.call(connection.target, data);
                } else if (typeof connection.method === 'string' && connection.target[connection.method]) {
                    connection.target[connection.method](data);
                }

                if (this.debugMode) {
                    const cpuUsed = Game.cpu.getUsed() - startTime;
                    if (cpuUsed > 0.1) { // 只显示CPU消耗大于0.1的处理器
                        console.log(`     ⚡ CPU: ${cpuUsed.toFixed(3)}`);
                    }
                }

                // 如果是一次性连接，标记为删除
                if (connection.oneShot) {
                    connectionsToRemove.push(connection);
                }
            } catch (error) {
                console.log(`❌ 信号 "${signal}" 执行错误:`, error);
                if (this.debugMode) {
                    const targetName = connection.target ? connection.target.constructor.name : 'null';
                    const methodName = typeof connection.method === 'string' ? connection.method : 'function';
                    console.log(`   错误发生在: ${targetName}.${methodName}`);
                }
            }
        }

        if (this.debugMode && connections.length > 0) {
            console.log(`   ✅ 信号 "${signal}" 处理完成`);
        }

        // 移除一次性连接
        if (connectionsToRemove.length > 0) {
            const remainingConnections = connections.filter(conn => !connectionsToRemove.includes(conn));
            if (remainingConnections.length === 0) {
                this.connections.delete(signal);
            } else {
                this.connections.set(signal, remainingConnections);
            }
        }
    }

    /**
     * 检查信号是否有连接
     * @param signal 信号名称
     */
    public isConnected(signal: string, target?: any, method?: string | Function): boolean {
        const connections = this.connections.get(signal);
        if (!connections) return false;

        if (target === undefined && method === undefined) {
            return connections.length > 0;
        }

        return connections.some(conn => {
            if (target && conn.target !== target) return false;
            if (method && conn.method !== method) return false;
            return true;
        });
    }

    /**
     * 获取信号的连接数量
     * @param signal 信号名称
     */
    public getConnectionCount(signal: string): number {
        const connections = this.connections.get(signal);
        return connections ? connections.length : 0;
    }

    /**
     * 获取所有信号名称
     */
    public getAllSignals(): string[] {
        return Array.from(this.connections.keys());
    }

    /**
     * 获取信号历史
     * @param count 获取最近的数量
     */
    public getSignalHistory(count?: number): Signal[] {
        if (count === undefined) return this.signalHistory.slice();
        return this.signalHistory.slice(-count);
    }

    /**
     * 清除所有连接
     */
    public clear(): void {
        this.connections.clear();
        this.signalHistory.length = 0;
    }

    /**
     * 获取调用者信息
     */
    private getCallerInfo(): string {
        try {
            const stack = new Error().stack;
            if (!stack) return 'unknown';
            
            const lines = stack.split('\n');
            // 跳过 Error, getCallerInfo, emit 这几层
            for (let i = 3; i < Math.min(lines.length, 8); i++) {
                const line = lines[i];
                if (line && !line.includes('SignalManager') && !line.includes('SignalEmitter')) {
                    // 提取函数名和文件信息
                    const match = line.match(/at\s+(.+?)\s+\(.*[/\\]([^/\\]+\.ts):\d+/);
                    if (match) {
                        return `${match[1]} (${match[2]})`;
                    }
                    
                    // 简化格式
                    const simpleMatch = line.match(/at\s+(.+)/);
                    if (simpleMatch) {
                        return simpleMatch[1].trim();
                    }
                }
            }
            return 'unknown caller';
        } catch (error) {
            return 'caller info error';
        }
    }

    /**
     * 启用/禁用调试模式
     */
    public setDebugMode(enabled: boolean): void {
        this.debugMode = enabled;
        console.log(`📡 信号系统调试模式: ${enabled ? '启用' : '禁用'}`);
    }

    /**
     * 获取调试模式状态
     */
    public isDebugMode(): boolean {
        return this.debugMode;
    }

    /**
     * 调试信息
     */
    public debugInfo(): void {
        console.log('=== 信号系统调试信息 ===');
        console.log(`总信号数: ${this.connections.size}`);
        console.log(`调试模式: ${this.debugMode ? '启用' : '禁用'}`);
        for (const [signal, connections] of this.connections) {
            console.log(`信号 "${signal}": ${connections.length} 个连接`);
            connections.forEach((conn, index) => {
                console.log(`  ${index + 1}. 目标: ${conn.target.constructor.name}, 方法: ${conn.method}, 优先级: ${conn.priority || 0}`);
            });
        }
    }
}

// 全局信号管理器实例
export const signals = SignalManager.getInstance();

// 全局调试函数，方便在控制台中使用
(global as any).enableSignalDebug = (enabled: boolean = true) => {
    signals.setDebugMode(enabled);
};

(global as any).signalDebugInfo = () => {
    signals.debugInfo();
};

// 信号装饰器 - 用于自动连接信号
export function signal(signalName: string, priority = 0) {
    return function(target: any, propertyKey: string, descriptor: PropertyDescriptor) {
        const originalMethod = descriptor.value;
        
        // 在类实例化后连接信号
        if (!target.constructor._signalConnections) {
            target.constructor._signalConnections = [];
        }
        target.constructor._signalConnections.push({
            signal: signalName,
            method: propertyKey,
            priority
        });

        return descriptor;
    };
}

// 基础信号发射器类
export class SignalEmitter {
    private _signals: Set<string> = new Set();

    /**
     * 定义信号
     * @param signalName 信号名称
     */
    protected defineSignal(signalName: string): void {
        this._signals.add(signalName);
    }

    /**
     * 发射信号
     * @param signalName 信号名称
     * @param data 信号数据
     */
    protected emitSignal(signalName: string, data?: any): void {
        signals.emit(signalName, data);
    }

    /**
     * 连接信号到此对象的方法
     * @param signalName 信号名称
     * @param methodName 方法名
     * @param oneShot 是否为一次性连接
     * @param priority 优先级
     */
    public connectSignal(signalName: string, methodName: string, oneShot = false, priority = 0): void {
        signals.connect(signalName, this, methodName, oneShot, priority);
    }

    /**
     * 断开信号连接
     * @param signalName 信号名称
     * @param methodName 方法名（可选）
     */
    public disconnectSignal(signalName: string, methodName?: string): void {
        signals.disconnect(signalName, this, methodName);
    }

    /**
     * 获取定义的信号列表
     */
    public getDefinedSignals(): string[] {
        return Array.from(this._signals);
    }

    /**
     * 自动连接装饰器标记的信号
     */
    public autoConnectSignals(): void {
        const connections = (this.constructor as any)._signalConnections;
        if (connections) {
            connections.forEach((conn: any) => {
                this.connectSignal(conn.signal, conn.method, false, conn.priority);
            });
        }
    }
} 
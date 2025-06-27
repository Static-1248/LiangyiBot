# Screeps 信号系统文档

这个文档列出了所有可用的信号、它们的参数类型和使用说明。

## 🎯 核心信号系统

### 信号管理器 (SignalManager)

- **单例模式**: `signals` 全局实例
- **方法**:
  - `connect(signal, target, method, oneShot?, priority?)` - 连接信号
  - `disconnect(signal, target?, method?)` - 断开信号
  - `emit(signal, data?)` - 发射信号
  - `once(signal, target, method, priority?)` - 一次性连接

## 📡 系统核心信号

### 内存管理信号 (MemoryManager)

| 信号名称 | 参数类型 | 描述 |
|---------|---------|------|
| `memory.creep_memory_cleared` | `{ creepName?: string, creepNames?: string[], count?: number }` | Creep内存被清理 |
| `memory.gc_executed` | `{ clearedPaths: string[], count: number, markers: GCMarker[] }` | GC执行完成 |
| `memory.timed_event_triggered` | `{ id: string, signal: string, executionCount: number }` | 定时事件被触发 |
| `memory.global_memory_updated` | `{ path: string, value?: any, deleted?: boolean }` | 全局内存更新 |

### 定时事件信号

| 信号名称 | 参数类型 | 描述 |
|---------|---------|------|
| `timed.interval_complete` | `{ eventId: string, data: any }` | 循环定时事件完成 |
| `timed.event_expired` | `{ eventId: string, reason: string }` | 定时事件过期 |

## 🤖 Creep 信号系统

### 基础 Creep 信号 (BaseCreep)

| 信号名称 | 参数类型 | 描述 |
|---------|---------|------|
| `creep.spawned` | `{ creep: Creep, role: string }` | Creep生成完成 |
| `creep.fully_spawned` | `{ creepName: string, role: string }` | Creep完全生成（延迟触发） |
| `creep.died` | `{ creep: Creep, age: number, role: string }` | Creep死亡 |
| `creep.moved` | `{ creep: Creep, target: RoomPosition\|RoomObject, result: ScreepsReturnCode }` | Creep移动 |
| `creep.arrived` | `{ creep: Creep, target: any, position: RoomPosition }` | Creep到达目标 |
| `creep.stuck` | `{ creep: Creep, target: any, reason: string }` | Creep被卡住 |
| `creep.energy_full` | `{ creep: Creep, energy: number }` | Creep能量满了 |
| `creep.energy_empty` | `{ creep: Creep, capacity: number }` | Creep能量空了 |
| `creep.task_started` | `{ creep: Creep, task: string }` | Creep开始任务 |
| `creep.task_completed` | `{ creep: Creep, task: string }` | Creep完成任务 |
| `creep.state_changed` | `{ creep: Creep, oldState: string, newState: string }` | Creep状态改变 |

### Builder Creep 信号 (BuilderCreep)

| 信号名称 | 参数类型 | 描述 |
|---------|---------|------|
| `builder.construction_started` | `{ creep: Creep, target: ConstructionSite }` | 开始建造 |
| `builder.construction_completed` | `{ creep: Creep, targetId: Id<ConstructionSite> }` | 建造完成 |
| `builder.repair_started` | `{ creep: Creep, target: Structure }` | 开始修理 |
| `builder.repair_completed` | `{ creep: Creep, target: Structure }` | 修理完成 |
| `builder.seeking_energy` | `{ creep: Creep }` | 寻求能量 |
| `builder.seeking_work` | `{ creep: Creep }` | 寻求工作 |

## 🏗️ 建筑管理信号

### 建筑管理器信号 (BuildingManager)

| 信号名称 | 参数类型 | 描述 |
|---------|---------|------|
| `building.plan_created` | `{ plan: BuildingPlan, planId: string }` | 建筑计划创建 |
| `building.plan_cancelled` | `{ plan: BuildingPlan, planId: string }` | 建筑计划取消 |
| `building.construction_site_placed` | `{ plan: BuildingPlan, position: RoomPosition }` | 建造点放置 |
| `building.construction_assigned` | `{ creep: Creep, target: ConstructionSite, plan?: BuildingPlan }` | 建造任务分配 |
| `building.construction_completed` | `{ plan: BuildingPlan, structure: Structure }` | 建筑建造完成 |
| `building.repair_assigned` | `{ creep: Creep, target: Structure }` | 修理任务分配 |
| `building.structure_destroyed` | `{ structure: Structure, roomName: string }` | 建筑被摧毁 |

## 🏰 房间管理信号

### 房间事件信号

| 信号名称 | 参数类型 | 描述 |
|---------|---------|------|
| `room.under_attack` | `{ roomName: string, hostiles: Creep[], hostileCount: number }` | 房间被攻击 |
| `room.structures_damaged` | `{ roomName: string, structures: Structure[], count: number }` | 建筑受损 |
| `room.controller_upgraded` | `{ roomName: string, level: number, oldLevel: number }` | 控制器升级 |
| `room.controller_downgraded` | `{ roomName: string, level: number }` | 控制器降级 |
| `room.energy_crisis` | `{ roomName: string, energyAvailable: number, energyCapacity: number }` | 能量危机 |

### 防御塔信号

| 信号名称 | 参数类型 | 描述 |
|---------|---------|------|
| `tower.attacked` | `{ tower: StructureTower, target: Creep, roomName: string }` | 防御塔攻击 |
| `tower.repaired` | `{ tower: StructureTower, target: Structure, roomName: string }` | 防御塔修理 |
| `tower.energy_low` | `{ tower: StructureTower, energy: number }` | 防御塔能量不足 |

## 🔧 自定义信号示例

### 资源管理信号

```typescript
// 发现资源
signals.emit('resource.found', {
    resourceType: RESOURCE_ENERGY,
    amount: 1000,
    position: new RoomPosition(25, 25, 'W1N1'),
    sourceId: 'source_id'
});

// 资源耗尽
signals.emit('resource.depleted', {
    sourceId: 'source_id',
    roomName: 'W1N1',
    lastHarvestTime: Game.time
});
```

### 任务系统信号

```typescript
// 任务创建
signals.emit('task.created', {
    taskId: 'task_001',
    type: 'harvest',
    priority: 5,
    assignedCreep: null,
    targetId: 'source_id'
});

// 任务分配
signals.emit('task.assigned', {
    taskId: 'task_001',
    creepName: 'Harvester_001',
    assignedAt: Game.time
});

// 任务完成
signals.emit('task.completed', {
    taskId: 'task_001',
    creepName: 'Harvester_001',
    completedAt: Game.time,
    result: 'success'
});
```

## 📊 信号优先级系统

信号连接支持优先级参数，数字越大优先级越高：

```typescript
// 高优先级监听器（优先执行）
signals.connect('creep.energy_full', this, 'onEnergyFull', false, 20);

// 普通优先级监听器
signals.connect('creep.energy_full', this, 'normalHandler', false, 10);

// 低优先级监听器（最后执行）
signals.connect('creep.energy_full', this, 'cleanup', false, 1);
```

## 🎭 信号装饰器使用

使用 `@signal` 装饰器自动连接信号：

```typescript
class MyCreep extends BaseCreep {
    @signal('creep.energy_full', 15)
    protected onEnergyFull(data: any): void {
        // 处理能量满了的逻辑
        this.say('能量满了！');
    }

    @signal('building.construction_assigned', 20)
    protected onTaskAssigned(data: { creep: Creep, target: ConstructionSite }): void {
        if (data.creep === this.creep) {
            this.say('收到新任务！');
        }
    }
}
```

## 🔄 信号链式反应

信号可以触发其他信号，形成链式反应：

```typescript
// 监听建造完成，触发下一步
signals.connect('builder.construction_completed', null, (data) => {
    // 建造完成后，检查是否需要修理
    signals.emit('building.check_repairs', {
        roomName: data.creep.room.name
    });
});

// 监听修理检查，分配修理任务
signals.connect('building.check_repairs', null, (data) => {
    // 寻找需要修理的建筑
    const damagedStructures = findDamagedStructures(data.roomName);
    if (damagedStructures.length > 0) {
        signals.emit('building.repair_needed', {
            roomName: data.roomName,
            structures: damagedStructures
        });
    }
});
```

## 🎯 定时信号系统

通过内存管理器添加定时信号：

```typescript
// 延迟5个tick后触发信号
memory.addTimedEvent('check_energy', 'room.energy_check', 5, {
    roomName: 'W1N1'
});

// 每10个tick循环触发信号，最多执行50次
memory.addTimedEvent('periodic_scan', 'room.scan', 10, {
    scanType: 'hostiles'
}, 10, 50);
```

## 🛠️ 调试工具

使用全局调试命令：

```typescript
// 控制台中可用的调试命令
debug.signalInfo()        // 显示所有信号连接信息
debug.memoryStats()       // 显示内存统计
debug.buildingPlans()     // 显示建筑计划
debug.emitTestSignal()    // 发射测试信号
debug.addTimedEvent('test.signal', 50)  // 添加定时测试信号

// 信号历史查看
signals.getSignalHistory(10)  // 获取最近10个信号
signals.getAllSignals()       // 获取所有注册的信号名称
```

## 🎨 最佳实践

### 1. 信号命名规范
- 使用点分隔的命名空间：`namespace.action`
- 例：`creep.spawned`, `building.completed`, `room.attacked`

### 2. 数据结构一致性
- 总是包含相关的对象引用
- 提供足够的上下文信息
- 使用TypeScript接口定义数据结构

### 3. 错误处理
- 信号系统自动捕获回调函数中的错误
- 使用try-catch包装复杂的信号处理逻辑

### 4. 性能考虑
- 避免在信号回调中执行耗时操作
- 使用优先级控制执行顺序
- 及时断开不需要的信号连接

### 5. 内存管理
- 在对象销毁时断开信号连接
- 使用一次性信号处理临时事件
- 定期清理过期的定时事件

这个信号系统为你的Screeps AI提供了强大的事件驱动架构，让各个模块之间能够灵活地通信和协作！🚀 
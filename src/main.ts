/**
 * 主循环 - 使用信号系统架构
 */
import { signals } from './SignalSystem';
import { memory } from './MemoryManager';
import { buildingManager } from './managers/BuildingManager';
import { BaseCreep } from './creeps/BaseCreep';
import { BuilderCreep } from './creeps/BuilderCreep';
import _ from 'lodash';

try {
    var config = require("./config");
    if (config !== undefined) {
        // 配置已加载
    }
}
catch (e) {
    // 配置文件不存在
}

// Creep类映射
const CREEP_CLASSES: { [role: string]: typeof BaseCreep } = {
    'builder': BuilderCreep,
    // 可以添加更多creep类型
};

// Creep实例缓存
const creepInstances: { [creepName: string]: BaseCreep } = {};

/**
 * 初始化信号系统
 */
function initializeSignalSystem(): void {
    // 连接全局信号监听器
    signals.connect('creep.spawned', null, (data: { creep: Creep, role: string }) => {
        console.log(`🎉 ${data.role} ${data.creep.name} 已生成`);
    });

    signals.connect('creep.died', null, (data: { creep: Creep, age: number, role: string }) => {
        console.log(`💀 ${data.role} ${data.creep.name} 死亡，年龄: ${data.age}`);
        // 清理实例缓存
        delete creepInstances[data.creep.name];
    });

    signals.connect('memory.creep_memory_cleared', null, (data: any) => {
        if (data.count) {
            console.log(`🧹 清理了 ${data.count} 个死亡creep的内存`);
        }
    });

    signals.connect('building.plan_created', null, (data: any) => {
        console.log(`📋 创建建筑计划: ${data.plan.structureType}`);
    });

    signals.connect('building.construction_completed', null, (data: any) => {
        console.log(`✅ 建造完成: ${data.plan.structureType}`);
    });

    console.log('📡 信号系统已初始化');
}

/**
 * 获取或创建Creep实例
 */
function getCreepInstance(creep: Creep): BaseCreep {
    if (!creepInstances[creep.name]) {
        const creepMemory = memory.getCreepMemory(creep.name, { role: 'builder', state: 'idle', born: Game.time });
        const CreepClass = CREEP_CLASSES[creepMemory.role] || BaseCreep;
        creepInstances[creep.name] = new CreepClass(creep);
    }
    return creepInstances[creep.name];
}

/**
 * 生成Creep
 */
function spawnCreeps(): void {
    for (const spawnName in Game.spawns) {
        const spawn = Game.spawns[spawnName];
        if (spawn.spawning) continue;

        const room = spawn.room;
        
                 // 统计各类型creep数量
         const creepsByRole = _.groupBy(
             Object.values(Game.creeps).filter(c => c.room.name === room.name), 
             c => memory.getCreepMemory(c.name).role || 'builder'
         );

        // 检查是否需要生成Builder
        const builders = creepsByRole['builder'] || [];
        const constructionSites = room.find(FIND_CONSTRUCTION_SITES);
        
        if (builders.length < 2 && constructionSites.length > 0) {
            const newName = `Builder_${Game.time}`;
            const result = spawn.spawnCreep([WORK, CARRY, MOVE], newName, {
                memory: { role: 'builder', state: 'idle', born: Game.time }
            });
            
            if (result === OK) {
                signals.emit('creep.spawned', {
                    creep: Game.creeps[newName], // 这个可能为undefined，但信号会在下个tick处理
                    role: 'builder'
                });
                
                // 添加定时信号，在creep完全生成后触发
                memory.addTimedEvent(
                    `creep_birth_${newName}`,
                    'creep.fully_spawned',
                    3, // 3 ticks后
                    { creepName: newName, role: 'builder' }
                );
            }
        }

                 // 显示生成状态
         if (spawn.spawning && spawn.spawning.name) {
             const spawningCreepName = spawn.spawning.name;
             const spawningCreep = Game.creeps[spawningCreepName];
             if (spawningCreep) {
                 const role = memory.getCreepMemory(spawningCreep.name).role || 'builder';
                 spawn.room.visual.text(
                     `🛠️${role}`,
                     spawn.pos.x + 1,
                     spawn.pos.y,
                     { align: 'left', opacity: 0.8 }
                 );
             }
         }
    }
}

/**
 * 运行房间逻辑
 */
function runRooms(): void {
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!room.controller || !room.controller.my) continue;

        // 检查房间事件
        checkRoomEvents(room);
        
        // 运行建筑管理器
        buildingManager.run();
        
        // 自动规划
        if (Game.time % 100 === 0) {
            buildingManager.autoPlanning(roomName);
        }

        // 运行防御塔
        runTowers(room);
    }
}

/**
 * 检查房间事件
 */
function checkRoomEvents(room: Room): void {
    // 检查敌对creep
    const hostiles = room.find(FIND_HOSTILE_CREEPS);
    if (hostiles.length > 0) {
        signals.emit('room.under_attack', {
            roomName: room.name,
            hostiles: hostiles,
            hostileCount: hostiles.length
        });
    }

    // 检查建筑损坏
    const damagedStructures = room.find(FIND_STRUCTURES, {
        filter: (structure) => structure.hits < structure.hitsMax * 0.5
    });
    
    if (damagedStructures.length > 0) {
        signals.emit('room.structures_damaged', {
            roomName: room.name,
            structures: damagedStructures,
            count: damagedStructures.length
        });
    }
}

/**
 * 运行防御塔
 */
function runTowers(room: Room): void {
    const towers = room.find(FIND_MY_STRUCTURES, {
        filter: (structure) => structure.structureType === STRUCTURE_TOWER
    }) as StructureTower[];

    for (const tower of towers) {
        // 优先攻击敌对creep
        const closestHostile = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
        if (closestHostile) {
            const result = tower.attack(closestHostile);
            if (result === OK) {
                signals.emit('tower.attacked', {
                    tower: tower,
                    target: closestHostile,
                    roomName: room.name
                });
            }
            continue;
        }

        // 修理受损建筑
        const closestDamagedStructure = tower.pos.findClosestByRange(FIND_STRUCTURES, {
            filter: (structure) => structure.hits < structure.hitsMax &&
                                 structure.structureType !== STRUCTURE_WALL &&
                                 structure.structureType !== STRUCTURE_RAMPART
        });
        
        if (closestDamagedStructure) {
            const result = tower.repair(closestDamagedStructure);
            if (result === OK) {
                signals.emit('tower.repaired', {
                    tower: tower,
                    target: closestDamagedStructure,
                    roomName: room.name
                });
            }
        }
    }
}

/**
 * 运行所有Creep
 */
function runCreeps(): void {
    for (const creepName in Game.creeps) {
        const creep = Game.creeps[creepName];
        const creepInstance = getCreepInstance(creep);
        
        try {
            creepInstance.run();
        } catch (error) {
            console.log(`Creep ${creepName} 运行错误:`, error);
        }
    }
}

/**
 * 调试命令
 */
function setupDebugCommands(): void {
    (global as any).signals = signals;
    (global as any).memory = memory;
    (global as any).buildingManager = buildingManager;
    
    // 调试命令示例
    (global as any).debug = {
        signalInfo: () => signals.debugInfo(),
        memoryStats: () => memory.getMemoryStats(),
        buildingPlans: () => buildingManager.getAllPlans(),
        emitTestSignal: () => signals.emit('test.signal', { message: '测试信号' }),
        addTimedEvent: (signal: string, delay: number) => {
            memory.addTimedEvent(`test_${Game.time}`, signal, delay, { test: true });
        }
    };
}

/**
 * 主循环
 */
export function loop(): void {
    // 初始化（只在第一次运行时执行）
    if (!memory.getGlobalMemory('system.initialized')) {
        initializeSignalSystem();
        setupDebugCommands();
        memory.setGlobalMemory('system.initialized', true);
    }

    // 运行内存管理器（处理GC和定时事件）
    memory.run();

    // 生成creep
    spawnCreeps();

    // 运行房间逻辑
    runRooms();

    // 运行所有creep
    runCreeps();

    // 性能统计
    if (Game.time % 100 === 0) {
        const stats = memory.getMemoryStats();
        console.log(`📊 内存统计: ${stats.totalMemoryUsage} 字节, ${stats.creepMemoryCount} 个creep`);
        
        const signalCount = signals.getAllSignals().length;
        console.log(`📡 信号统计: ${signalCount} 个信号类型`);
    }
}
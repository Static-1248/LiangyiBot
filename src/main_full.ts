/**
 * 主循环 - 使用信号系统架构
 */
import { signals } from './SignalSystem';
import { memory } from './MemoryManager';
import { buildingManager } from './managers/BuildingManager';
import { globalConfig } from './config/GlobalConfig';
import { BaseCreep } from './creeps/BaseCreep';
import { BuilderCreep } from './creeps/BuilderCreep';
import { UpgraderCreep } from './creeps/UpgraderCreep';
import { MinerCreep } from './creeps/MinerCreep';
import { HaulerCreep } from './creeps/HaulerCreep';
// import { SupplierCreep } from './creeps/SupplierCreep'; // 暂时注释
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
    'upgrader': UpgraderCreep,
    'miner': MinerCreep,
    'hauler': HaulerCreep,
    // 'supplier': SupplierCreep, // 暂时注释
    // 可以添加更多creep类型
};

// Creep实例缓存
const creepInstances: { [creepName: string]: BaseCreep } = {};

/**
 * 初始化信号系统
 */
function initializeSignalSystem(): void {
    // 连接全局信号监听器
    signals.connect('creep.spawned', null, (data: { creepName: string, role: string }) => {
        const creep = Game.creeps[data.creepName];
        if (creep) {
            console.log(`🎉 ${data.role} ${creep.name} 已生成`);
        }
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

    // 监听miner的容器建议
    signals.connect('miner.container_needed', null, (data: any) => {
        buildingManager.createPlan(STRUCTURE_CONTAINER, data.suggestedPos, 7);
        console.log(`📦 根据miner建议在 ${data.suggestedPos} 创建容器计划`);
    });

    // 监听upgrader的容器建议
    signals.connect('upgrader.container_needed', null, (data: any) => {
        buildingManager.createPlan(STRUCTURE_CONTAINER, data.suggestedPos, 6);
        console.log(`📦 根据upgrader建议在 ${data.suggestedPos} 创建容器计划`);
    });

    console.log('📡 信号系统已初始化');
}

/**
 * 获取或创建Creep实例
 */
function getCreepInstance(creep: Creep): BaseCreep {
    if (!creepInstances[creep.name]) {
        try {
            const creepMemory = memory.getCreepMemory(creep.name, { role: 'builder', state: 'idle', born: Game.time });
            console.log(`🔨 为 ${creep.name} 创建实例，角色: ${creepMemory.role}`);
            
            const CreepClass = CREEP_CLASSES[creepMemory.role] || BaseCreep;
            if (!CreepClass) {
                console.log(`❌ 找不到角色 ${creepMemory.role} 的类定义`);
                return new BaseCreep(creep);
            }
            
            creepInstances[creep.name] = new CreepClass(creep);
            console.log(`✅ 成功创建 ${creep.name} 的实例`);
            
        } catch (error) {
            console.log(`❌ 创建creep实例失败 ${creep.name}:`, error);
            console.log(`❌ 错误堆栈:`, error.stack);
            // fallback到基础类
            creepInstances[creep.name] = new BaseCreep(creep);
        }
    }
    return creepInstances[creep.name];
}

/**
 * 获取房间creep统计
 */
function getRoomCreepStats(roomName: string): { [role: string]: number } {
    const roomCreeps = Object.values(Game.creeps).filter(creep => creep.room.name === roomName);
    const stats: { [role: string]: number } = {};
    
    for (const creep of roomCreeps) {
        const role = memory.getCreepMemory(creep.name).role || 'unknown';
        stats[role] = (stats[role] || 0) + 1;
    }
    
    return stats;
}

/**
 * 生成Creep
 */
function spawnCreeps(): void {
    for (const spawnName in Game.spawns) {
        const spawn = Game.spawns[spawnName];
        if (spawn.spawning) continue;

        const room = spawn.room;
        const roomName = room.name;
        
        // 获取房间creep统计
        const creepStats = getRoomCreepStats(roomName);
        
        // 按优先级获取所有角色
        const rolesByPriority = globalConfig.getRolesByPriority();
        
        let spawnedRole: string | null = null;
        
        for (const role of rolesByPriority) {
            const currentCount = creepStats[role] || 0;
            let targetCount: number;
            
            // 特殊规则处理
            if (role === 'upgrader') {
                targetCount = globalConfig.getUpgraderCount(roomName);
            } else if (role === 'miner') {
                targetCount = globalConfig.getMinerCount(roomName);
            } else {
                targetCount = globalConfig.getRoomCreepLimit(roomName, role);
            }
            
            // 检查是否需要生成
            if (currentCount < targetCount) {
                const roleConfig = globalConfig.getCreepRoleConfig(role);
                if (!roleConfig) continue;
                
                // 检查能量是否足够
                const energyCapacity = room.energyCapacityAvailable;
                if (energyCapacity < roleConfig.minEnergyCapacity) continue;
                
                // 获取适合的身体部件
                const bodyParts = globalConfig.getBodyParts(role, energyCapacity);
                const cost = globalConfig.calculateBodyCost(bodyParts);
                
                if (room.energyAvailable >= cost) {
                    const newName = `${role.charAt(0).toUpperCase() + role.slice(1)}_${Game.time}`;
                    const result = spawn.spawnCreep(bodyParts, newName, {
                        memory: { role, state: 'idle', born: Game.time }
                    });
                    
                    if (result === OK) {
                        // 由于creep可能还没有完全生成，使用延迟信号
                        memory.addTimedEvent(
                            `creep_spawned_${newName}`,
                            'creep.spawned',
                            1,
                            { creepName: newName, role: role }
                        );
                        
                        // 添加定时信号，在creep完全生成后触发
                        memory.addTimedEvent(
                            `creep_birth_${newName}`,
                            'creep.fully_spawned',
                            3,
                            { creepName: newName, role: role }
                        );
                        
                        spawnedRole = role;
                        console.log(`🐣 生成 ${role}: ${newName} (成本: ${cost})`);
                        break;
                    }
                }
            }
        }

        // 显示生成状态
        if (spawn.spawning) {
            const spawningInfo = spawn.spawning;
            // spawningInfo.name 在 TypeScript 中类型可能有问题，使用 any 类型断言
            const spawningName = (spawningInfo as any).name;
            if (spawningName && Game.creeps[spawningName]) {
                const spawningCreep = Game.creeps[spawningName];
                const role = memory.getCreepMemory(spawningCreep.name).role || 'unknown';
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

    // 检查能量状况
    const energyRatio = room.energyAvailable / room.energyCapacityAvailable;
    if (energyRatio < 0.3) {
        signals.emit('room.energy_crisis', {
            roomName: room.name,
            energyAvailable: room.energyAvailable,
            energyCapacity: room.energyCapacityAvailable
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
    const creepCount = Object.keys(Game.creeps).length;
    if (creepCount === 0) {
        console.log('⚠️ 没有creep需要运行');
        return;
    }
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const creepName in Game.creeps) {
        const creep = Game.creeps[creepName];
        
        try {
            const creepInstance = getCreepInstance(creep);
            if (!creepInstance) {
                console.log(`❌ 无法创建creep实例: ${creepName}`);
                errorCount++;
                continue;
            }
            
            creepInstance.run();
            successCount++;
            
            // 每10个tick显示一次creep状态
            if (Game.time % 10 === 0) {
                const memory = creepInstance.getMemory();
                console.log(`🤖 ${creepName}(${memory.role}): 状态=${memory.state}, 能量=${creep.store.energy}/${creep.store.getCapacity()}`);
            }
            
        } catch (error) {
            console.log(`❌ Creep ${creepName} 运行错误:`, error);
            console.log(`❌ 错误堆栈:`, error.stack);
            errorCount++;
        }
    }
    
    if (Game.time % 10 === 0) {
        console.log(`📈 Creep运行统计: 成功=${successCount}, 失败=${errorCount}, 总计=${creepCount}`);
    }
}

/**
 * 调试命令
 */
function setupDebugCommands(): void {
    (global as any).signals = signals;
    (global as any).memory = memory;
    (global as any).buildingManager = buildingManager;
    (global as any).globalConfig = globalConfig;
    
    // 调试命令示例
    (global as any).debug = {
        signalInfo: () => signals.debugInfo(),
        memoryStats: () => memory.getMemoryStats(),
        buildingPlans: () => buildingManager.getAllPlans(),
        config: () => globalConfig.getFullConfig(),
        creepStats: (roomName: string) => getRoomCreepStats(roomName),
        setCreepLimit: (roomName: string, role: string, count: number) => {
            globalConfig.setRoomCreepLimit(roomName, role, count);
        },
        exportConfig: () => globalConfig.exportConfig(),
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
    try {
        console.log(`🔄 Tick ${Game.time} 开始`);
        
        // 初始化（只在第一次运行时执行）
        if (!memory.getGlobalMemory('system.initialized')) {
            console.log('🚀 首次运行，初始化系统...');
            try {
                initializeSignalSystem();
                console.log('✅ 信号系统初始化完成');
            } catch (error) {
                console.log('❌ 信号系统初始化失败:', error);
                throw error;
            }
            
            try {
                setupDebugCommands();
                console.log('✅ 调试命令设置完成');
            } catch (error) {
                console.log('❌ 调试命令设置失败:', error);
                throw error;
            }
            
            memory.setGlobalMemory('system.initialized', true);
            console.log('✅ 系统初始化完成');
        }

        // 运行内存管理器（处理GC和定时事件）
        try {
            memory.run();
            if (Game.time % 10 === 0) console.log('✅ 内存管理器运行正常');
        } catch (error) {
            console.log('❌ 内存管理器运行失败:', error);
            throw error;
        }

        // 生成creep
        try {
            spawnCreeps();
            if (Game.time % 10 === 0) console.log('✅ 生成逻辑运行正常');
        } catch (error) {
            console.log('❌ 生成逻辑失败:', error);
            throw error;
        }

        // 运行房间逻辑
        try {
            runRooms();
            if (Game.time % 10 === 0) console.log('✅ 房间逻辑运行正常');
        } catch (error) {
            console.log('❌ 房间逻辑失败:', error);
            throw error;
        }

        // 运行所有creep
        try {
            runCreeps();
            if (Game.time % 10 === 0) console.log('✅ Creep逻辑运行正常');
        } catch (error) {
            console.log('❌ Creep逻辑失败:', error);
            throw error;
        }

        // 性能统计
        if (Game.time % 100 === 0) {
            try {
                const stats = memory.getMemoryStats();
                console.log(`📊 内存统计: ${stats.totalMemoryUsage} 字节, ${stats.creepMemoryCount} 个creep`);
                
                const signalCount = signals.getAllSignals().length;
                console.log(`📡 信号统计: ${signalCount} 个信号类型`);
                
                // 显示各房间creep统计
                for (const roomName in Game.rooms) {
                    const room = Game.rooms[roomName];
                    if (room.controller && room.controller.my) {
                        const creepStats = getRoomCreepStats(roomName);
                        const statsStr = Object.entries(creepStats)
                            .map(([role, count]) => `${role}:${count}`)
                            .join(' ');
                        console.log(`🏠 ${roomName}: ${statsStr}`);
                    }
                }
            } catch (error) {
                console.log('❌ 性能统计失败:', error);
            }
        }
        
        console.log(`✅ Tick ${Game.time} 完成`);
        
    } catch (error) {
        console.log('💥 主循环致命错误:', error);
        console.log('错误堆栈:', error.stack);
        
        // 尝试恢复基本功能
        try {
            console.log('🔄 尝试紧急恢复...');
            for (const name in Game.creeps) {
                const creep = Game.creeps[name];
                if (creep.memory.role === 'upgrader' && creep.store.energy === 0) {
                    const source = creep.pos.findClosestByPath(FIND_SOURCES);
                    if (source) creep.moveTo(source);
                }
            }
        } catch (recoveryError) {
            console.log('💀 紧急恢复也失败了:', recoveryError);
        }
    }
}
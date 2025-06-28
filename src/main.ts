/**
 * 主循环 - 事件检测和信号发射架构
 */

console.log('🚀 加载事件驱动主循环...');

import { signals } from './SignalSystem';
import { memory } from './MemoryManager';

// 加载所有管理器，实例化并注册它们的事件监听器
// 按优先级顺序加载：SpawnManager > SupplierManager > UpgraderManager > HaulerManager > MinerManager > BuilderManager
import './managers/SpawnManager';
import './managers/SupplierManager';
import './managers/UpgraderManager';
import './managers/HaulerManager';
import './managers/MinerManager';
import './managers/BuilderManager';

// 加载规划器
import './planners/BuildingPlanner';
import './planners/HarvestPlanner';
import { harvestPlanner } from './planners/HarvestPlanner';

// 导入creep类
import { SupplierCreep } from './creeps/SupplierCreep';
import { MinerCreep } from './creeps/MinerCreep';
import { UpgraderCreep } from './creeps/UpgraderCreep';
import { BuilderCreep } from './creeps/BuilderCreep';
import { HaulerCreep } from './creeps/HaulerCreep';
import { BaseCreep } from './creeps/BaseCreep';

console.log('✅ 核心模块加载完成');

// 全局调试函数
(global as any).debugHarvestPlanner = () => {
    harvestPlanner.forceDebug();
};

// 全局CPU性能监控
(global as any).debugCPU = () => {
    console.log(`🔥 CPU 监控报告 - Tick ${Game.time}`);
    console.log(`当前CPU使用: ${Game.cpu.getUsed().toFixed(3)} / ${Game.cpu.limit}`);
    console.log(`Bucket: ${Game.cpu.bucket}`);
    
    // 统计creep数量
    const creepCounts: { [role: string]: number } = {};
    let totalCreeps = 0;
    for (const creepName in Game.creeps) {
        const role = Game.creeps[creepName].memory.role;
        creepCounts[role] = (creepCounts[role] || 0) + 1;
        totalCreeps++;
    }
    
    console.log(`总Creep数量: ${totalCreeps}`);
    for (const role in creepCounts) {
        console.log(`  - ${role}: ${creepCounts[role]}`);
    }
    
    // 统计缓存的creep实例数量
    const cachedInstances = Object.keys(creepInstances).length;
    console.log(`缓存的Creep实例: ${cachedInstances}`);
    
    // HarvestPlanner状态
    console.log(`HarvestPlanner 状态:`);
    const stats = harvestPlanner.getSourceStats();
    console.log(`  - 矿源: ${stats.totalSources}, 请求队列: ${harvestPlanner['harvestRequests'].length}, 分配: ${Object.keys(harvestPlanner['assignments']).length}`);
};

// 全局creep实例缓存，避免每tick重复创建
const creepInstances: { [creepName: string]: BaseCreep } = {};

/**
 * 清理creep实例缓存
 */
function cleanupCreepInstances(): void {
    for (const creepName in creepInstances) {
        if (!Game.creeps[creepName]) {
            delete creepInstances[creepName];
        }
    }
}

/**
 * 获取或创建creep实例
 */
function getCreepInstance(creep: Creep): BaseCreep {
    const creepName = creep.name;
    
    // 如果实例已存在，直接返回
    if (creepInstances[creepName]) {
        return creepInstances[creepName];
    }
    
    // 根据角色创建新实例
    const role = creep.memory.role;
    let instance: BaseCreep;
    
    switch (role) {
        case 'supplier':
            instance = new SupplierCreep(creep);
            break;
            
        case 'miner':
            instance = new MinerCreep(creep);
            break;
            
        case 'upgrader':
            instance = new UpgraderCreep(creep);
            break;
            
        case 'builder':
            instance = new BuilderCreep(creep);
            break;
            
        case 'hauler':
            instance = new HaulerCreep(creep);
            break;
            
        default:
            instance = new BaseCreep(creep);
            console.log(`⚠️ 未知角色: ${role} (${creepName})`);
            break;
    }
    
    // 缓存实例
    creepInstances[creepName] = instance;
    console.log(`🆕 创建新creep实例: ${creepName} (${role})`);
    
    return instance;
}

/**
 * 初始化事件系统
 */
function initializeEventSystem(): void {
    console.log('📡 初始化事件系统...');
    
    // 基础系统信号
    signals.connect('system.tick_start', null, () => {
        console.log(`🔄 Tick ${Game.time} 开始`);
    });
    
    signals.connect('system.tick_end', null, () => {
        if (Game.time % 10 === 0) {
            console.log(`✅ Tick ${Game.time} 完成，CPU: ${Game.cpu.getUsed()}`);
        }
    });
    
    console.log('✅ 事件系统初始化完成');
}

/**
 * 检测房间事件
 */
function detectRoomEvents(): void {
    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!room.controller || !room.controller.my) continue;

        // 检测spawn状态变化
        const spawns = room.find(FIND_MY_SPAWNS);
        for (const spawn of spawns) {
            if (spawn.spawning) {
                const spawningCreep = Game.creeps[spawn.spawning.name];
                if (spawningCreep && !spawningCreep.memory.spawnEventSent) {
                    signals.emit('spawn.creep_spawning', {
                        spawnId: spawn.id,
                        creepName: spawn.spawning.name,
                        roomName: roomName
                    });
                    spawningCreep.memory.spawnEventSent = true;
                }
            }
        }

        // 检测能量状况
        const energyRatio = room.energyAvailable / room.energyCapacityAvailable;
        if (energyRatio < 0.3) {
            signals.emit('room.energy_low', {
                roomName: roomName,
                energyAvailable: room.energyAvailable,
                energyCapacity: room.energyCapacityAvailable,
                ratio: energyRatio
            });
        } else if (energyRatio >= 1.0) {
            signals.emit('room.energy_full', {
                roomName: roomName,
                energyAvailable: room.energyAvailable
            });
        }

        // 检测敌对creep
        const hostiles = room.find(FIND_HOSTILE_CREEPS);
        if (hostiles.length > 0) {
            signals.emit('room.hostiles_detected', {
                roomName: roomName,
                hostiles: hostiles,
                count: hostiles.length
            });
        }

        // 检测建筑损坏
        const damagedStructures = room.find(FIND_STRUCTURES, {
            filter: (structure) => structure.hits < structure.hitsMax * 0.8
        });
        if (damagedStructures.length > 0) {
            signals.emit('room.structures_damaged', {
                roomName: roomName,
                structures: damagedStructures,
                count: damagedStructures.length
            });
        }

        // 检测建造工地
        const constructionSites = room.find(FIND_CONSTRUCTION_SITES);
        if (constructionSites.length > 0) {
            signals.emit('room.construction_sites_available', {
                roomName: roomName,
                sites: constructionSites,
                count: constructionSites.length
            });
        }
    }
}

/**
 * 运行creep逻辑 - 使用缓存的creep实例
 */
function runCreeps(): void {
    for (const creepName in Game.creeps) {
        const creep = Game.creeps[creepName];
        
        try {
            // 获取或创建creep实例（只在第一次创建）
            const creepInstance = getCreepInstance(creep);
            creepInstance.run();
        } catch (error) {
            console.log(`Error running creep ${creepName}:`, error);
        }
    }
}

/**
 * 检测creep事件
 */
function detectCreepEvents(): void {
    for (const creepName in Game.creeps) {
        const creep = Game.creeps[creepName];
        const lastEnergy = creep.memory.lastEnergy || 0;
        const currentEnergy = creep.store.energy;
        
        // 检测能量状态变化
        if (lastEnergy === 0 && currentEnergy > 0) {
            signals.emit('creep.energy_gained', {
                creepName: creepName,
                creep: creep,
                amount: currentEnergy
            });
        } else if (lastEnergy > 0 && currentEnergy === 0) {
            signals.emit('creep.energy_empty', {
                creepName: creepName,
                creep: creep
            });
        } else if (currentEnergy === creep.store.getCapacity(RESOURCE_ENERGY)) {
            signals.emit('creep.energy_full', {
                creepName: creepName,
                creep: creep,
                capacity: creep.store.getCapacity(RESOURCE_ENERGY)
            });
        }
        
        // 更新上一次的能量值
        creep.memory.lastEnergy = currentEnergy;
        
        // 检测creep死亡即将发生
        if (creep.ticksToLive && creep.ticksToLive < 50) {
            signals.emit('creep.near_death', {
                creepName: creepName,
                creep: creep,
                ticksToLive: creep.ticksToLive
            });
        }
    }
}

/**
 * 检测spawn需求
 */
function detectSpawnNeeds(): void {
    // 此函数的功能已被具体的角色管理器 (SupplierManager, MinerManager, etc.) 接管。
    // 管理器会根据各自的逻辑发出 spawn 请求信号。
    // 保留此函数为空，或在未来用于某些集中的、非特定角色的生成逻辑。
}

/**
 * 清理死亡creep内存
 */
function cleanupDeadCreeps(): void {
    let cleaned = 0;
    for (const name in Memory.creeps) {
        if (!Game.creeps[name]) {
            delete Memory.creeps[name];
            cleaned++;
            signals.emit('creep.memory_cleaned', {
                creepName: name
            });
        }
    }
    
    // 清理creep实例缓存
    cleanupCreepInstances();
    
    if (cleaned > 0) {
        signals.emit('system.memory_cleaned', {
            count: cleaned
        });
    }
}

/**
 * 主循环 - 只负责事件检测和信号发射
 */
export function loop(): void {
    try {
        // 发射tick开始信号
        signals.emit('system.tick_start', { tick: Game.time });
        
        // 清理死亡creep内存
        cleanupDeadCreeps();
        
        // 运行creep逻辑
        runCreeps();
        
        // 检测各种游戏事件
        detectRoomEvents();
        detectCreepEvents();
        detectSpawnNeeds(); // 这个函数现在是空的，但保持调用结构
        
        // 运行内存管理器处理定时事件
        memory.run();
        
        // 发射tick结束信号
        signals.emit('system.tick_end', { 
            tick: Game.time, 
            cpuUsed: Game.cpu.getUsed() 
        });
        
    } catch (error) {
        console.log('💥 主循环错误:', error);
        signals.emit('system.error', {
            error: error,
            tick: Game.time,
            location: 'main_loop'
        });
    }
}

console.log('🎯 事件驱动主循环准备就绪');
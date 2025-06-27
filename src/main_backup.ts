/**
 * 紧急恢复版本的主循环
 */
import { signals } from './SignalSystem';
import { memory } from './MemoryManager';
import { globalConfig } from './config/GlobalConfig';
import { BaseCreep } from './creeps/BaseCreep';
import { BuilderCreep } from './creeps/BuilderCreep';
import { UpgraderCreep } from './creeps/UpgraderCreep';
import { MinerCreep } from './creeps/MinerCreep';
import { HaulerCreep } from './creeps/HaulerCreep';

// Creep类映射
const CREEP_CLASSES: { [role: string]: typeof BaseCreep } = {
    'builder': BuilderCreep,
    'upgrader': UpgraderCreep,
    'miner': MinerCreep,
    'hauler': HaulerCreep,
};

// Creep实例缓存
const creepInstances: { [creepName: string]: BaseCreep } = {};

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
 * 运行所有Creep
 */
function runCreeps(): void {
    for (const creepName in Game.creeps) {
        const creep = Game.creeps[creepName];
        try {
            const creepInstance = getCreepInstance(creep);
            creepInstance.run();
        } catch (error) {
            console.log(`Creep ${creepName} 运行错误:`, error);
        }
    }
}

/**
 * 简化的生成逻辑
 */
function simpleSpawn(): void {
    for (const spawnName in Game.spawns) {
        const spawn = Game.spawns[spawnName];
        if (spawn.spawning) continue;

        const room = spawn.room;
        
        // 简单统计
        const creepCount = Object.values(Game.creeps).filter(c => c.room.name === room.name).length;
        
        // 如果creep太少，生成upgrader
        if (creepCount < 2 && room.energyAvailable >= 300) {
            const result = spawn.spawnCreep([WORK, WORK, CARRY, MOVE], `Upgrader_${Game.time}`, {
                memory: { role: 'upgrader', state: 'idle', born: Game.time }
            });
            
            if (result === OK) {
                console.log(`紧急生成upgrader: Upgrader_${Game.time}`);
            }
        }
    }
}

/**
 * 紧急恢复主循环
 */
export function loop(): void {
    try {
        // 清理死亡creep内存
        memory.clearDeadCreepsMemory();
        
        // 简化生成
        simpleSpawn();
        
        // 运行所有creep
        runCreeps();
        
    } catch (error) {
        console.log('主循环错误:', error);
    }
} 
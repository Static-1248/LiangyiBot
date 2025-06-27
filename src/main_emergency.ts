/**
 * 超级简化的紧急主循环
 */

// 清理死亡creep内存
function cleanDeadCreeps(): void {
    for (const name in Memory.creeps) {
        if (!Game.creeps[name]) {
            delete Memory.creeps[name];
        }
    }
}

// 简单的upgrader逻辑
function runUpgrader(creep: Creep): void {
    if (creep.store.energy === 0) {
        const source = creep.pos.findClosestByPath(FIND_SOURCES);
        if (source && creep.harvest(source) === ERR_NOT_IN_RANGE) {
            creep.moveTo(source);
        }
    } else {
        if (creep.room.controller && creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
            creep.moveTo(creep.room.controller);
        }
    }
}

// 简单的builder逻辑
function runBuilder(creep: Creep): void {
    if (creep.store.energy === 0) {
        const source = creep.pos.findClosestByPath(FIND_SOURCES);
        if (source && creep.harvest(source) === ERR_NOT_IN_RANGE) {
            creep.moveTo(source);
        }
    } else {
        const target = creep.pos.findClosestByPath(FIND_CONSTRUCTION_SITES);
        if (target) {
            if (creep.build(target) === ERR_NOT_IN_RANGE) {
                creep.moveTo(target);
            }
        } else if (creep.room.controller) {
            if (creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
                creep.moveTo(creep.room.controller);
            }
        }
    }
}

// 生成creep
function spawnCreeps(): void {
    for (const spawnName in Game.spawns) {
        const spawn = Game.spawns[spawnName];
        if (spawn.spawning) continue;

        const creeps = Object.values(Game.creeps);
        const upgraders = creeps.filter(c => c.memory.role === 'upgrader');
        const builders = creeps.filter(c => c.memory.role === 'builder');

        if (upgraders.length < 2 && spawn.room.energyAvailable >= 300) {
            spawn.spawnCreep([WORK, WORK, CARRY, MOVE], `Upgrader_${Game.time}`, {
                memory: { role: 'upgrader' }
            });
        } else if (builders.length < 1 && spawn.room.energyAvailable >= 300) {
            spawn.spawnCreep([WORK, CARRY, CARRY, MOVE, MOVE], `Builder_${Game.time}`, {
                memory: { role: 'builder' }
            });
        }
    }
}

// 主循环
export function loop(): void {
    console.log(`Tick ${Game.time}: 紧急模式运行中`);
    
    cleanDeadCreeps();
    spawnCreeps();
    
    for (const name in Game.creeps) {
        const creep = Game.creeps[name];
        
        if (creep.memory.role === 'upgrader') {
            runUpgrader(creep);
        } else if (creep.memory.role === 'builder') {
            runBuilder(creep);
        }
    }
} 
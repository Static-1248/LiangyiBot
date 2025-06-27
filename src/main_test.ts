/**
 * 最简测试版本 - 逐步排查问题
 */

console.log('🧪 开始测试脚本加载...');

// 第一步：测试基本功能
export function loop(): void {
    console.log(`🟢 Tick ${Game.time}: 基础脚本正常运行`);
    
    // 最简单的upgrader逻辑
    for (const name in Game.creeps) {
        const creep = Game.creeps[name];
        if (creep.store.energy === 0) {
            const source = creep.pos.findClosestByPath(FIND_SOURCES);
            if (source && creep.harvest(source) === ERR_NOT_IN_RANGE) {
                creep.moveTo(source);
                creep.say('⛏️挖矿');
            }
        } else {
            if (creep.room.controller && creep.upgradeController(creep.room.controller) === ERR_NOT_IN_RANGE) {
                creep.moveTo(creep.room.controller);
                creep.say('⬆️升级');
            }
        }
    }
    
    // 简单生成
    for (const spawnName in Game.spawns) {
        const spawn = Game.spawns[spawnName];
        if (!spawn.spawning && Object.keys(Game.creeps).length < 2) {
            if (spawn.room.energyAvailable >= 300) {
                spawn.spawnCreep([WORK, WORK, CARRY, MOVE], `Test_${Game.time}`, {
                    memory: { role: 'upgrader' }
                });
                console.log(`🐣 生成测试upgrader: Test_${Game.time}`);
            }
        }
    }
}

console.log('✅ 基础测试脚本加载完成'); 

import { Harvester, CreepHarvester } from './roles/harvester';
import { Upgrader, CreepUpgrader } from './roles/upgrader';
import { Builder, CreepBuilder } from './roles/builder';
import _ from 'lodash';
import './types';

import config from './config';
import { CreepOutpostReserver, outpostReserverRecipe } from './roles/outpostReserver';


export function loop() {

    for (var name in Memory.creeps) {
        if (!Game.creeps[name]) {
            delete Memory.creeps[name];
            console.log('Clearing non-existing creep memory:', name);
        }
    }

    for (const roomName in Game.rooms) {
        const room = Game.rooms[roomName];
        if (!room.controller) continue;
        if (!room.controller.my) continue;
        if (room.controller.level < 1) continue;

        const spawns = room.find(FIND_MY_SPAWNS);
        if (spawns.length > 0) {
            const spawn = spawns[0];

            const harvesters = _.filter(Game.creeps, (creep) => creep.memory.role == 'harvester' && creep.room.name == room.name);
            if (harvesters.length < 4) {
                const newName = 'Harvester' + Game.time;
                console.log('Spawning new harvester: ' + newName);
                spawn.spawnCreep([WORK, CARRY, MOVE], newName,
                    { memory: { role: 'harvester' } });
            }

            const upgraders = _.filter(Game.creeps, (creep) => creep.memory.role == 'upgrader' && creep.room.name == room.name);
            if (upgraders.length < 2) {
                const newName = 'Upgrader' + Game.time;
                console.log('Spawning new upgrader: ' + newName);
                spawn.spawnCreep([WORK, CARRY, MOVE], newName,
                    { memory: { role: 'upgrader' } });
            }

            const builders = _.filter(Game.creeps, (creep) => creep.memory.role == 'builder' && creep.room.name == room.name);
            const constructionSites = room.find(FIND_CONSTRUCTION_SITES);
            if (builders.length < 2 && constructionSites.length > 0) {
                const newName = 'Builder' + Game.time;
                console.log('Spawning new builder: ' + newName);
                spawn.spawnCreep([WORK, CARRY, MOVE], newName,
                    { memory: { role: 'builder' } });
            }

            if (config.outposts && config.outposts[room.name]) {
                for (const outpost of config.outposts[room.name]) {
                    const outpostReservers = _.filter(Game.creeps, (creep) => {
                        return creep.memory.role == 'outpostReserver' && (creep as CreepOutpostReserver).memory.targetRoom == outpost
                    });
                    if (outpostReservers.length < 1) {
                        const newName = `OutpostReserver-${outpost}-${Game.time}`;
                        const res = spawn.spawnCreep(
                            outpostReserverRecipe,
                            newName,
                            { memory: { role: 'outpostReserver', targetRoom: outpost } });
                        if (res == OK) {
                            console.log('Spawning new outpost reserver: ' + newName);
                        } else if (res == ERR_NOT_ENOUGH_ENERGY) {
                            console.log('Not enough energy to spawn outpost reserver: ' + newName);
                        } else {
                            console.log('Error spawning outpost reserver: ' + newName + '. Error code: ' + res);
                        }
                    }
                }
            }

            if (spawn.spawning) {
                const spawningCreep = Game.creeps[spawn.spawning.name];
                spawn.room.visual.text(
                    '🛠️' + spawningCreep.memory.role,
                    spawn.pos.x + 1,
                    spawn.pos.y,
                    { align: 'left', opacity: 0.8 });
            }

        }

        const towers = room.find(FIND_MY_STRUCTURES, {
            filter: (structure) => structure.structureType === STRUCTURE_TOWER
        }) as StructureTower[];
        for (const tower of towers) {
            const closestHostile = tower.pos.findClosestByRange(FIND_HOSTILE_CREEPS);
            if (closestHostile) {
                tower.attack(closestHostile);
            } else {
                const closestDamagedStructure = tower.pos.findClosestByRange(FIND_STRUCTURES, {
                    filter: (structure) => structure.hits < structure.hitsMax
                });
                if (closestDamagedStructure) {
                    tower.repair(closestDamagedStructure);
                }
            }
        }

    }


    for (const creepName in Game.creeps) {
        var creep = Game.creeps[creepName];
        if (!creep.memory.role) {
            creep.memory.role = 'harvester'; // Default role if not set
        }
        if (creep.memory.role == 'harvester') {
            Harvester.run(creep as CreepHarvester);
        }
        if (creep.memory.role == 'upgrader') {
            Upgrader.run(creep as CreepUpgrader);
        }
        if (creep.memory.role == 'builder') {
            Builder.run(creep as CreepBuilder);
        }
    }
}
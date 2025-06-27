import config from "../config";
import { CreepRecipe } from "../types";


interface CreepOutpostReserver extends Creep {
    memory: CreepOutpostReserverMemory;
}
interface CreepOutpostReserverMemory extends CreepMemory {
    role: 'outpostReserver';

    /** Whether the creep is currently reserving or harvesting */
    reserving: boolean;
    
    /** The room the creep is targeting for reservation */
    targetRoom: string;
}
const outpostReserverRecipe: CreepRecipe = [WORK, CARRY, MOVE, WORK, CARRY, MOVE, WORK, CARRY, MOVE];

const roleOutpostReserver = {

    /** @param {Creep} creep **/
    run: function (creep: CreepOutpostReserver) {

        if (!creep.memory.reserving) {
            creep.memory.reserving = false;
        }
        if (creep.memory.reserving && creep.store[RESOURCE_ENERGY] == 0) {
            creep.memory.reserving = false;
            creep.say('🔄 harvest');
        }
        if (!creep.memory.reserving && creep.store.getFreeCapacity() == 0) {
            creep.memory.reserving = true;
            creep.say('⚡ upgrade');
        }

        if (creep.memory.reserving) {
            if (!creep.room.name || creep.room.name != creep.memory.targetRoom) {
                const exitDir = Game.map.findExit(creep.room.name, creep.memory.targetRoom);
                if (exitDir != ERR_NO_PATH && exitDir != ERR_INVALID_ARGS) {
                    const exit = creep.pos.findClosestByRange(exitDir);
                    if (exit) {                    
                        const res = creep.moveTo(exit, { visualizePathStyle: { stroke: '#ffffff' } });
                        if (res == ERR_NO_PATH) {
                            console.log('No path found for creep: ' + creep.name + ' to exit: ' + exitDir + ' in room: ' + creep.room.name);
                        } else if (res != OK) {
                            console.log('Error moving creep: ' + creep.name + ' to exit: ' + exitDir + ' in room: ' + creep.room.name + '. Error code: ' + res);
                        }
                    } else {
                        console.log('No exit found for creep: ' + creep.name + ' in room: ' + creep.room.name);
                    }
                } else {
                    console.log('No exit found for creep: ' + creep.name);
                }
                return;
            }
            if (creep.room.controller) {
                const res = creep.reserveController(creep.room.controller);
                if (res == ERR_NOT_IN_RANGE) {
                    creep.moveTo(creep.room.controller, { visualizePathStyle: { stroke: '#ffffff' } });
                } 
                if (res == OK 
                    && config.signature 
                    && (!creep.room.controller.sign 
                        || creep.room.controller.sign.text != config.signature)) {
                    creep.signController(creep.room.controller, config.signature);
                }
            }
        } else {
            const source = creep.pos.findClosestByPath(FIND_SOURCES);
            if(!source) {
                console.log('No source found for creep: ' + creep.name);
                return;
            }
            if(creep.harvest(source) == ERR_NOT_IN_RANGE) {
                creep.moveTo(source, {visualizePathStyle: {stroke: '#ffaa00'}});
            }
        }
    }
};

export {
    roleOutpostReserver as OutpostReserver,
    CreepOutpostReserver,
    outpostReserverRecipe
};
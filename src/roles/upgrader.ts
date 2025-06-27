import config from "../config";


interface CreepUpgrader extends Creep {
    memory: CreepUpgraderMemory;
}
interface CreepUpgraderMemory extends CreepMemory {
    role: 'upgrader';
    /** Whether the creep is currently upgrading or harvesting */
    upgrading: boolean;
}

const roleUpgrader = {

    /** @param {Creep} creep **/
    run: function (creep: CreepUpgrader) {

        if (!creep.memory.upgrading) {
            creep.memory.upgrading = false;
        }
        if (creep.memory.upgrading && creep.store[RESOURCE_ENERGY] == 0) {
            creep.memory.upgrading = false;
            creep.say('🔄 harvest');
        }
        if (!creep.memory.upgrading && creep.store.getFreeCapacity() == 0) {
            creep.memory.upgrading = true;
            creep.say('⚡ upgrade');
        }

        if (creep.memory.upgrading) {
            if (creep.room.controller) {
                const res = creep.upgradeController(creep.room.controller);
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
    roleUpgrader as Upgrader,
    CreepUpgrader
};

interface CreepHarvester extends Creep {
    memory: CreepHarvesterMemory;
}
interface CreepHarvesterMemory extends CreepMemory {
    role: 'harvester';
}

const roleHarvester = {

    /** @param {Creep} creep **/
    run: function(creep: CreepHarvester) {
	    if(creep.store.getFreeCapacity() > 0
	       && creep.room.energyCapacityAvailable - creep.room.energyAvailable > 0) {
            const source = creep.pos.findClosestByPath(FIND_SOURCES);
            if(!source) {
                console.log('No source found for creep: ' + creep.name);
                return;
            }
            if(creep.harvest(source) == ERR_NOT_IN_RANGE) {
                creep.moveTo(source, {visualizePathStyle: {stroke: '#ffaa00'}});
            }
        } else {
            const targets = creep.room.find(FIND_STRUCTURES, {
                    filter: (structure) => {
                        return (structure.structureType == STRUCTURE_EXTENSION ||
                                structure.structureType == STRUCTURE_SPAWN ||
                                structure.structureType == STRUCTURE_TOWER) && 
                                structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0;
                    }
            });
            if(targets.length > 0) {
                if(creep.transfer(targets[0], RESOURCE_ENERGY) == ERR_NOT_IN_RANGE) {
                    creep.moveTo(targets[0], {visualizePathStyle: {stroke: '#ffffff'}});
                }
            }
        }
	}
};

export {
    roleHarvester as Harvester,
    CreepHarvester
};
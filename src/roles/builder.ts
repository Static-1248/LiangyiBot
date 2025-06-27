
interface CreepBuilder extends Creep {
	memory: CreepBuilderMemory;
}
interface CreepBuilderMemory extends CreepMemory {
	role: 'builder';
	/** Whether the creep is currently building or harvesting */
	building: boolean;
}

const roleBuilder = {

	/** @param {CreepBuilder} creep **/
	run: function (creep: CreepBuilder) {

		if (!creep.memory.building) {
			creep.memory.building = false;
		}
		if (creep.memory.building && creep.store[RESOURCE_ENERGY] == 0) {
			creep.memory.building = false;
			creep.say('🔄 harvest');
		}
		if (!creep.memory.building && creep.store.getFreeCapacity() == 0) {
			creep.memory.building = true;
			creep.say('🚧 build');
		}

		if (creep.memory.building) {
			const targets = creep.room.find(FIND_CONSTRUCTION_SITES);
			if (targets.length) {
				if (creep.build(targets[0]) == ERR_NOT_IN_RANGE) {
					creep.moveTo(targets[0], { visualizePathStyle: { stroke: '#ffffff' } });
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
	roleBuilder as Builder,
	CreepBuilder
};
/**
 * 建筑管理器 - 管理建筑规划、建造任务分配等
 */
import { SignalEmitter, signal, signals } from '../SignalSystem';
import { memory } from '../MemoryManager';

// 建筑规划接口
export interface BuildingPlan {
    id: string;
    structureType: BuildableStructureConstant;
    pos: RoomPosition;
    priority: number;
    roomName: string;
    status: 'planned' | 'placed' | 'building' | 'completed';
    assignedBuilder?: string;
    createdTime: number;
}

// 建筑管理器内存接口
export interface BuildingManagerMemory {
    plans: { [planId: string]: BuildingPlan };
    roomPlans: { [roomName: string]: string[] }; // 按房间存储计划ID
    nextPlanId: number;
    lastPlanningTime: number;
}

export class BuildingManager extends SignalEmitter {
    private static instance: BuildingManager;
    private managerMemory: BuildingManagerMemory;

    private constructor() {
        super();
        
        // 定义管理器信号
        this.defineSignal('building.plan_created');
        this.defineSignal('building.plan_cancelled');
        this.defineSignal('building.construction_site_placed');
        this.defineSignal('building.construction_assigned');
        this.defineSignal('building.construction_completed');
        this.defineSignal('building.repair_assigned');
        this.defineSignal('building.structure_destroyed');

        // 初始化内存
        this.managerMemory = memory.getGlobalMemory('managers.building', {
            plans: {},
            roomPlans: {},
            nextPlanId: 1,
            lastPlanningTime: 0
        });

        // 自动连接信号
        this.autoConnectSignals();
    }

    public static getInstance(): BuildingManager {
        if (!BuildingManager.instance) {
            BuildingManager.instance = new BuildingManager();
        }
        return BuildingManager.instance;
    }

    /**
     * 创建建筑计划
     * @param structureType 建筑类型
     * @param pos 位置
     * @param priority 优先级
     */
    public createPlan(
        structureType: BuildableStructureConstant, 
        pos: RoomPosition, 
        priority: number = 5
    ): string {
        const planId = `plan_${this.managerMemory.nextPlanId++}`;
        
        const plan: BuildingPlan = {
            id: planId,
            structureType,
            pos,
            priority,
            roomName: pos.roomName,
            status: 'planned',
            createdTime: Game.time
        };

        this.managerMemory.plans[planId] = plan;
        
        // 按房间存储
        if (!this.managerMemory.roomPlans[pos.roomName]) {
            this.managerMemory.roomPlans[pos.roomName] = [];
        }
        this.managerMemory.roomPlans[pos.roomName].push(planId);

        // 保存内存
        this.saveMemory();

        this.emitSignal('building.plan_created', {
            plan,
            planId
        });

        console.log(`📋 创建建筑计划: ${structureType} 在 ${pos}`);
        return planId;
    }

    /**
     * 取消建筑计划
     */
    public cancelPlan(planId: string): boolean {
        const plan = this.managerMemory.plans[planId];
        if (!plan) return false;

        // 从房间计划中移除
        const roomPlans = this.managerMemory.roomPlans[plan.roomName];
        if (roomPlans) {
            const index = roomPlans.indexOf(planId);
            if (index > -1) {
                roomPlans.splice(index, 1);
            }
        }

        delete this.managerMemory.plans[planId];
        this.saveMemory();

        this.emitSignal('building.plan_cancelled', {
            plan,
            planId
        });

        return true;
    }

    /**
     * 执行建筑计划 - 放置建造点
     */
    public executePlans(): void {
        const currentTime = Game.time;
        
        // 限制执行频率
        if (currentTime - this.managerMemory.lastPlanningTime < 10) return;
        this.managerMemory.lastPlanningTime = currentTime;

        for (const planId in this.managerMemory.plans) {
            const plan = this.managerMemory.plans[planId];
            
            if (plan.status === 'planned') {
                this.tryPlaceConstructionSite(plan);
            } else if (plan.status === 'placed') {
                this.checkConstructionProgress(plan);
            }
        }

        this.saveMemory();
    }

    /**
     * 尝试放置建造点
     */
    private tryPlaceConstructionSite(plan: BuildingPlan): void {
        const room = Game.rooms[plan.roomName];
        if (!room) return;

        const result = room.createConstructionSite(plan.pos.x, plan.pos.y, plan.structureType);
        
        if (result === OK) {
            plan.status = 'placed';
            this.emitSignal('building.construction_site_placed', {
                plan,
                position: plan.pos
            });
            console.log(`🏗️ 放置建造点: ${plan.structureType} 在 ${plan.pos}`);
        } else if (result === ERR_INVALID_TARGET) {
            // 位置已有建筑，标记为完成
            plan.status = 'completed';
        }
    }

    /**
     * 检查建造进度
     */
    private checkConstructionProgress(plan: BuildingPlan): void {
        const room = Game.rooms[plan.roomName];
        if (!room) return;

        // 检查建造点是否还存在
        const constructionSites = room.lookForAt(LOOK_CONSTRUCTION_SITES, plan.pos.x, plan.pos.y);
        
        if (constructionSites.length === 0) {
            // 建造点消失，检查是否建造完成
            const structures = room.lookForAt(LOOK_STRUCTURES, plan.pos.x, plan.pos.y);
            const targetStructure = structures.find(s => s.structureType === plan.structureType);
            
            if (targetStructure) {
                plan.status = 'completed';
                this.emitSignal('building.construction_completed', {
                    plan,
                    structure: targetStructure
                });
                console.log(`✅ 建造完成: ${plan.structureType} 在 ${plan.pos}`);
            } else {
                // 建造点被取消，重新标记为计划状态
                plan.status = 'planned';
            }
        }
    }

    /**
     * 分配建造任务给builder
     */
    public assignConstructionTask(builderCreep: Creep): boolean {
        const room = builderCreep.room;
        const constructionSites = room.find(FIND_CONSTRUCTION_SITES);
        
        if (constructionSites.length === 0) return false;

        // 按优先级排序建造点
        const sortedSites = constructionSites.sort((a, b) => {
            const planA = this.findPlanByPosition(a.pos);
            const planB = this.findPlanByPosition(b.pos);
            
            const priorityA = planA ? planA.priority : 5;
            const priorityB = planB ? planB.priority : 5;
            
            return priorityB - priorityA; // 高优先级在前
        });

        const target = builderCreep.pos.findClosestByPath(sortedSites);
        if (!target) return false;

        // 更新计划状态
        const plan = this.findPlanByPosition(target.pos);
        if (plan && plan.status === 'placed') {
            plan.status = 'building';
            plan.assignedBuilder = builderCreep.name;
        }

        this.emitSignal('building.construction_assigned', {
            creep: builderCreep,
            target,
            plan
        });

        return true;
    }

    /**
     * 分配修理任务给builder
     */
    public assignRepairTask(builderCreep: Creep): boolean {
        const room = builderCreep.room;
        
        // 寻找需要修理的建筑
        const damagedStructures = room.find(FIND_STRUCTURES, {
            filter: (structure) => {
                return structure.hits < structure.hitsMax * 0.8 &&
                       structure.structureType !== STRUCTURE_WALL &&
                       structure.structureType !== STRUCTURE_RAMPART;
            }
        });

        if (damagedStructures.length === 0) return false;

        // 按损坏程度排序
        const sortedStructures = damagedStructures.sort((a, b) => {
            const damageA = (a.hitsMax - a.hits) / a.hitsMax;
            const damageB = (b.hitsMax - b.hits) / b.hitsMax;
            return damageB - damageA; // 损坏严重的在前
        });

        const target = builderCreep.pos.findClosestByPath(sortedStructures);
        if (!target) return false;

        this.emitSignal('building.repair_assigned', {
            creep: builderCreep,
            target
        });

        return true;
    }

    /**
     * 根据位置查找计划
     */
    private findPlanByPosition(pos: RoomPosition): BuildingPlan | null {
        const roomPlans = this.managerMemory.roomPlans[pos.roomName];
        if (!roomPlans) return null;

        for (const planId of roomPlans) {
            const plan = this.managerMemory.plans[planId];
            if (plan && plan.pos.x === pos.x && plan.pos.y === pos.y) {
                return plan;
            }
        }
        return null;
    }

    /**
     * 获取房间的建筑计划
     */
    public getRoomPlans(roomName: string): BuildingPlan[] {
        const planIds = this.managerMemory.roomPlans[roomName] || [];
        return planIds.map(id => this.managerMemory.plans[id]).filter(Boolean);
    }

    /**
     * 获取所有计划
     */
    public getAllPlans(): BuildingPlan[] {
        return Object.values(this.managerMemory.plans);
    }

    /**
     * 保存内存
     */
    private saveMemory(): void {
        memory.setGlobalMemory('managers.building', this.managerMemory);
    }

    /**
     * 信号监听器：Builder寻求工作
     */
    @signal('builder.seeking_work', 10)
    protected onBuilderSeekingWork(data: { creep: Creep }): void {
        const assigned = this.assignConstructionTask(data.creep) || this.assignRepairTask(data.creep);
        if (assigned) {
            console.log(`📝 为 ${data.creep.name} 分配了任务`);
        }
    }

    /**
     * 信号监听器：建造完成
     */
    @signal('builder.construction_completed', 15)
    protected onConstructionCompleted(data: { creep: Creep, targetId: Id<ConstructionSite> }): void {
        // 更新计划状态
        for (const planId in this.managerMemory.plans) {
            const plan = this.managerMemory.plans[planId];
            if (plan.assignedBuilder === data.creep.name && plan.status === 'building') {
                plan.status = 'completed';
                plan.assignedBuilder = undefined;
                break;
            }
        }
        this.saveMemory();
    }

    /**
     * 信号监听器：建筑被摧毁
     */
    @signal('room.structure_destroyed', 20)
    protected onStructureDestroyed(data: { structure: Structure, roomName: string }): void {
        this.emitSignal('building.structure_destroyed', data);
        
        // 可以在这里添加重建逻辑
        console.log(`💥 建筑被摧毁: ${data.structure.structureType} 在 ${data.roomName}`);
    }

    /**
     * 运行建筑管理器
     */
    public run(): void {
        this.executePlans();
    }

    /**
     * 自动规划基础建筑
     */
    public autoPlanning(roomName: string): void {
        const room = Game.rooms[roomName];
        if (!room || !room.controller || !room.controller.my) return;

        const level = room.controller.level;
        const spawn = room.find(FIND_MY_SPAWNS)[0];
        if (!spawn) return;

        // 简单的自动规划逻辑
        if (level >= 2) {
            this.planExtensions(room, spawn);
        }
        
        if (level >= 3) {
            this.planTower(room, spawn);
        }
    }

    /**
     * 规划扩展建筑
     */
    private planExtensions(room: Room, spawn: StructureSpawn): void {
        const extensions = room.find(FIND_MY_STRUCTURES, {
            filter: (s) => s.structureType === STRUCTURE_EXTENSION
        });

        const maxExtensions = CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][room.controller!.level];
        
        if (extensions.length < maxExtensions) {
            // 在spawn周围寻找合适位置
            for (let x = spawn.pos.x - 2; x <= spawn.pos.x + 2; x++) {
                for (let y = spawn.pos.y - 2; y <= spawn.pos.y + 2; y++) {
                    if (extensions.length >= maxExtensions) break;
                    
                    const pos = new RoomPosition(x, y, room.name);
                    if (this.isValidBuildPosition(pos)) {
                        this.createPlan(STRUCTURE_EXTENSION, pos, 8);
                    }
                }
                if (extensions.length >= maxExtensions) break;
            }
        }
    }

    /**
     * 规划防御塔
     */
    private planTower(room: Room, spawn: StructureSpawn): void {
        const towers = room.find(FIND_MY_STRUCTURES, {
            filter: (s) => s.structureType === STRUCTURE_TOWER
        });

        const maxTowers = CONTROLLER_STRUCTURES[STRUCTURE_TOWER][room.controller!.level];
        
        if (towers.length < maxTowers) {
            const pos = new RoomPosition(spawn.pos.x + 3, spawn.pos.y, room.name);
            if (this.isValidBuildPosition(pos)) {
                this.createPlan(STRUCTURE_TOWER, pos, 9);
            }
        }
    }

    /**
     * 检查位置是否可以建造
     */
    private isValidBuildPosition(pos: RoomPosition): boolean {
        const room = Game.rooms[pos.roomName];
        if (!room) return false;

        const terrain = room.getTerrain();
        if (terrain.get(pos.x, pos.y) === TERRAIN_MASK_WALL) return false;

        const structures = pos.lookFor(LOOK_STRUCTURES);
        if (structures.length > 0) return false;

        const sites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
        if (sites.length > 0) return false;

        return true;
    }
}

// 全局建筑管理器实例
export const buildingManager = BuildingManager.getInstance(); 
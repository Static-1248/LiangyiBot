import { signals } from '../SignalSystem';
import { memory } from '../MemoryManager';
import _ from 'lodash';

interface SourcePosition {
    /** 位置坐标 */
    x: number;
    y: number;
    /** 是否被墙阻挡 */
    isBlocked: boolean;
    /** 当前占用的creep名称，null表示空闲 */
    occupiedBy: string | null;
    /** 最后更新时间 */
    lastUpdated: number;
}

interface SourceData {
    /** 矿源ID */
    sourceId: string;
    /** 房间名称 */
    roomName: string;
    /** 矿源周围可采集位置 */
    positions: SourcePosition[];
    /** 总可用位置数 */
    totalPositions: number;
    /** 当前空闲位置数 */
    freePositions: number;
    /** 最后扫描时间 */
    lastScanned: number;
}

interface HarvestRequest {
    /** 请求的creep名称 */
    creepName: string;
    /** creep所在房间 */
    roomName: string;
    /** 请求时间 */
    requestTime: number;
    /** 优先级（数字越小优先级越高） */
    priority: number;
    /** 是否可以跨房间 */
    allowCrossRoom: boolean;
}

/**
 * 采集规划器
 * - 监控所有矿源周围8个位置的占用情况
 * - 接收creep的能量需求请求并智能分配矿源
 * - 支持跨房间矿源分配
 * - 区分处理Miner(RCL4+)的站桩挖矿和普通creep的动态挖矿
 */
class HarvestPlanner {
    /** 所有房间的矿源数据 */
    private sourceDatabase: { [sourceId: string]: SourceData } = {};
    
    /** 挖矿请求队列 */
    private harvestRequests: HarvestRequest[] = [];
    
    /** 已分配的挖矿任务 */
    private assignments: { [creepName: string]: string } = {}; // creepName -> sourceId
    
    /** 扫描间隔（每20 ticks扫描一次地形） */
    private readonly SCAN_INTERVAL = 20;
    
    /** 请求超时时间（100 ticks） */
    private readonly REQUEST_TIMEOUT = 100;
    
    /** 相邻房间扫描间隔（每100 ticks扫描一次） */
    private readonly ADJACENT_SCAN_INTERVAL = 100;
    
    /** 已扫描的相邻房间缓存 */
    private adjacentRoomsCache: { [roomName: string]: string[] } = {};

    constructor() {
        // 连接到tick开始信号
        signals.connect('system.tick_start', null, () => this.run());
        
        // 监听挖矿需求信号
        signals.connect('harvest.need_source', null, (data: any) => this.handleHarvestRequest(data));
        
        // 监听creep死亡信号，清理分配
        signals.connect('creep.memory_cleaned', null, (data: any) => this.handleCreepDeath(data));
        
        this.initializeSourceDatabase();
        
        console.log('[HarvestPlanner] 采集规划器已初始化');
    }

    /**
     * 初始化矿源数据库
     */
    private initializeSourceDatabase(): void {
        // 从内存中恢复数据
        const savedData = memory.getGlobalMemory('planner.harvest.sources');
        if (savedData) {
            this.sourceDatabase = savedData;
        }
        
        const savedAssignments = memory.getGlobalMemory('planner.harvest.assignments');
        if (savedAssignments) {
            this.assignments = savedAssignments;
        }
        
        const savedAdjacentRooms = memory.getGlobalMemory('planner.harvest.adjacentRooms');
        if (savedAdjacentRooms) {
            this.adjacentRoomsCache = savedAdjacentRooms;
        }
        
        // 扫描所有可见房间的矿源
        this.scanAllSources();
        
        // 立即扫描相邻房间
        this.scanAdjacentRooms();
    }

    /**
     * 主运行逻辑
     */
    private run(): void {
        // 减少占用状态更新频率（每5tick更新一次）
        if (Game.time % 5 === 0) {
            this.updateOccupancyStatus();
        }
        
        // 每20个tick重新扫描地形
        if (Game.time % this.SCAN_INTERVAL === 0) {
            this.scanAllSources();
        }
        
        // 每100个tick扫描相邻房间
        if (Game.time % this.ADJACENT_SCAN_INTERVAL === 0) {
            this.scanAdjacentRooms();
        }
        
        // 处理挖矿请求
        this.processHarvestRequests();
        
        // 清理超时请求（减少频率）
        if (Game.time % 10 === 0) {
            this.cleanupTimeoutRequests();
        }
        
        // 减少保存频率（每5tick保存一次）
        if (Game.time % 5 === 0) {
            this.saveData();
        }
        
        // 调试信息（每50 ticks输出一次）
        if (Game.time % 50 === 0) {
            this.debugStatus();
        }
    }

    /**
     * 扫描所有可见房间的矿源
     */
    private scanAllSources(): void {
        for (const roomName in Game.rooms) {
            const room = Game.rooms[roomName];
            const sources = room.find(FIND_SOURCES);
            
            for (const source of sources) {
                this.scanSource(source);
            }
        }
    }

    /**
     * 扫描单个矿源周围的位置
     */
    private scanSource(source: Source): void {
        const sourceId = source.id;
        const roomName = source.room.name;
        const terrain = source.room.getTerrain();
        
        if (!this.sourceDatabase[sourceId]) {
            this.sourceDatabase[sourceId] = {
                sourceId,
                roomName,
                positions: [],
                totalPositions: 0,
                freePositions: 0,
                lastScanned: Game.time
            };
        }
        
        const sourceData = this.sourceDatabase[sourceId];
        sourceData.positions = [];
        
        // 扫描矿源周围3x3区域（除了中心位置）
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue; // 跳过矿源自身位置
                
                const x = source.pos.x + dx;
                const y = source.pos.y + dy;
                
                // 检查位置是否在房间范围内
                if (x < 0 || x > 49 || y < 0 || y > 49) continue;
                
                // 检查地形
                const isBlocked = terrain.get(x, y) === TERRAIN_MASK_WALL;
                
                sourceData.positions.push({
                    x,
                    y,
                    isBlocked,
                    occupiedBy: null,
                    lastUpdated: Game.time
                });
            }
        }
        
        sourceData.totalPositions = sourceData.positions.filter(pos => !pos.isBlocked).length;
        sourceData.lastScanned = Game.time;
        
        console.log(`[HarvestPlanner] 扫描矿源 ${sourceId} 在 ${roomName}，可用位置: ${sourceData.totalPositions}`);
    }

    /**
     * 更新所有矿源的占用状态（优化版本）
     */
    private updateOccupancyStatus(): void {
        // 只处理有分配的creep，避免遍历所有creep
        const assignedCreeps = Object.keys(this.assignments);
        
        if (assignedCreeps.length === 0) {
            // 如果没有分配的creep，直接清空所有占用状态
            for (const sourceId in this.sourceDatabase) {
                const sourceData = this.sourceDatabase[sourceId];
                sourceData.positions.forEach(pos => {
                    pos.occupiedBy = null;
                });
                sourceData.freePositions = sourceData.positions.filter(pos => !pos.isBlocked).length;
            }
            return;
        }
        
        // 先清空所有占用状态（只清空有分配的矿源）
        const activeSources = new Set(Object.values(this.assignments));
        for (const sourceId of activeSources) {
            if (this.sourceDatabase[sourceId]) {
                const sourceData = this.sourceDatabase[sourceId];
                sourceData.positions.forEach(pos => {
                    pos.occupiedBy = null;
                });
            }
        }
        
        // 只检查已分配的creep
        for (const creepName of assignedCreeps) {
            const creep = Game.creeps[creepName];
            if (!creep) {
                // creep已死亡，清理分配（延迟到下次信号处理）
                continue;
            }
            
            const assignedSourceId = this.assignments[creepName];
            const sourceData = this.sourceDatabase[assignedSourceId];
            
            if (!sourceData) continue;
            
            // 快速距离检查（避免调用safeGetObjectById）
            const sourcePos = sourceData.positions[0]; // 使用第一个位置作为参考
            if (!sourcePos) continue;
            
            // 简化的距离检查
            const dx = Math.abs(creep.pos.x - sourcePos.x);
            const dy = Math.abs(creep.pos.y - sourcePos.y);
            if (dx <= 2 && dy <= 2 && creep.room.name === sourceData.roomName) {
                // 找到creep占用的具体位置
                const position = sourceData.positions.find(pos => 
                    pos.x === creep.pos.x && pos.y === creep.pos.y && !pos.isBlocked
                );
                
                if (position) {
                    position.occupiedBy = creepName;
                    position.lastUpdated = Game.time;
                }
            }
        }
        
        // 只更新有变化的矿源的空闲位置计数
        for (const sourceId of activeSources) {
            if (this.sourceDatabase[sourceId]) {
                const sourceData = this.sourceDatabase[sourceId];
                sourceData.freePositions = sourceData.positions.filter(pos => 
                    !pos.isBlocked && !pos.occupiedBy
                ).length;
            }
        }
    }

    /**
     * 处理挖矿请求
     */
    private handleHarvestRequest(data: any): void {
        const request: HarvestRequest = {
            creepName: data.creepName,
            roomName: data.roomName,
            requestTime: Game.time,
            priority: data.priority || 5,
            allowCrossRoom: data.allowCrossRoom || false
        };
        
        // 检查是否已经有分配
        if (this.assignments[request.creepName]) {
            return; // 已经分配了矿源
        }
        
        // 检查是否已经在请求队列中
        const existingRequest = this.harvestRequests.find(req => req.creepName === request.creepName);
        if (existingRequest) {
            return; // 已经在队列中
        }
        
        this.harvestRequests.push(request);
        console.log(`[HarvestPlanner] 收到挖矿请求：${request.creepName} 在 ${request.roomName}`);
    }

    /**
     * 处理挖矿请求队列
     */
    private processHarvestRequests(): void {
        if (this.harvestRequests.length === 0) return;
        
        // 按优先级排序
        this.harvestRequests.sort((a, b) => a.priority - b.priority);
        
        for (let i = this.harvestRequests.length - 1; i >= 0; i--) {
            const request = this.harvestRequests[i];
            const creep = Game.creeps[request.creepName];
            
            // 检查creep是否还存在
            if (!creep) {
                this.harvestRequests.splice(i, 1);
                continue;
            }
            
            // 尝试分配矿源（支持相邻房间）
            const assignedSourceId = this.assignSourceToCreep(request);
            if (assignedSourceId) {
                this.assignments[request.creepName] = assignedSourceId;
                this.harvestRequests.splice(i, 1);
                
                // 发送分配信号
                signals.emit('harvest.source_assigned', {
                    creepName: request.creepName,
                    sourceId: assignedSourceId,
                    roomName: this.sourceDatabase[assignedSourceId].roomName
                });
                
                console.log(`[HarvestPlanner] 分配矿源 ${assignedSourceId} 给 ${request.creepName}`);
            }
        }
    }

    /**
     * 处理creep死亡，清理分配
     */
    private handleCreepDeath(data: any): void {
        const creepName = data.creepName;
        if (this.assignments[creepName]) {
            delete this.assignments[creepName];
            console.log(`[HarvestPlanner] 清理已死亡creep ${creepName} 的矿源分配`);
        }
        
        // 从请求队列中移除
        this.harvestRequests = this.harvestRequests.filter(req => req.creepName !== creepName);
    }

    /**
     * 清理超时请求
     */
    private cleanupTimeoutRequests(): void {
        const currentTime = Game.time;
        this.harvestRequests = this.harvestRequests.filter(req => {
            const isTimeout = currentTime - req.requestTime > this.REQUEST_TIMEOUT;
            if (isTimeout) {
                console.log(`[HarvestPlanner] 清理超时请求：${req.creepName}`);
            }
            return !isTimeout;
        });
    }

    /**
     * 保存数据到内存
     */
    private saveData(): void {
        memory.setGlobalMemory('planner.harvest.sources', this.sourceDatabase);
        memory.setGlobalMemory('planner.harvest.assignments', this.assignments);
        memory.setGlobalMemory('planner.harvest.adjacentRooms', this.adjacentRoomsCache);
    }

    /**
     * 获取creep分配的矿源
     */
    public getAssignedSource(creepName: string): string | null {
        return this.assignments[creepName] || null;
    }

    /**
     * 手动释放creep的矿源分配
     */
    public releaseCreepAssignment(creepName: string): void {
        if (this.assignments[creepName]) {
            delete this.assignments[creepName];
            console.log(`[HarvestPlanner] 手动释放 ${creepName} 的矿源分配`);
        }
    }

    /**
     * 获取矿源统计信息
     */
    public getSourceStats(roomName?: string): any {
        const stats: any = {
            totalSources: 0,
            totalPositions: 0,
            freePositions: 0,
            occupiedPositions: 0,
            sources: []
        };
        
        for (const sourceId in this.sourceDatabase) {
            const sourceData = this.sourceDatabase[sourceId];
            
            if (roomName && sourceData.roomName !== roomName) continue;
            
            stats.totalSources++;
            stats.totalPositions += sourceData.totalPositions;
            stats.freePositions += sourceData.freePositions;
            stats.occupiedPositions += sourceData.totalPositions - sourceData.freePositions;
            
            stats.sources.push({
                sourceId,
                roomName: sourceData.roomName,
                totalPositions: sourceData.totalPositions,
                freePositions: sourceData.freePositions,
                occupancyRate: Math.round((1 - sourceData.freePositions / sourceData.totalPositions) * 100)
            });
        }
        
        return stats;
    }

    /**
     * 获取跨房间挖矿统计信息
     */
    public getCrossRoomStats(): any {
        const stats = {
            totalAdjacentRooms: 0,
            accessibleAdjacentRooms: 0,
            crossRoomSources: 0,
            myRooms: [] as string[],
            adjacentRoomDetails: {} as any
        };
        
        // 统计我方房间和相邻房间
        for (const roomName in Game.rooms) {
            const room = Game.rooms[roomName];
            if (room.controller && room.controller.my) {
                stats.myRooms.push(roomName);
                
                const adjacentRooms = this.adjacentRoomsCache[roomName] || [];
                stats.totalAdjacentRooms += adjacentRooms.length;
                
                const accessibleRooms = adjacentRooms.filter(adjRoom => 
                    this.isRoomAccessible(adjRoom)
                );
                stats.accessibleAdjacentRooms += accessibleRooms.length;
                
                stats.adjacentRoomDetails[roomName] = {
                    adjacent: adjacentRooms,
                    accessible: accessibleRooms
                };
            }
        }
        
        // 统计跨房间矿源
        for (const sourceId in this.sourceDatabase) {
            const sourceData = this.sourceDatabase[sourceId];
            const isMyRoom = stats.myRooms.includes(sourceData.roomName);
            
            if (!isMyRoom) {
                stats.crossRoomSources++;
            }
        }
        
        return stats;
    }

    /**
     * 检查矿源是否已满（用于Miner管理）
     */
    public isSourceFull(sourceId: string): boolean {
        const sourceData = this.sourceDatabase[sourceId];
        return sourceData ? sourceData.freePositions <= 0 : false;
    }

    /**
     * 获取相邻房间名称
     * @param roomName - 中心房间名称
     * @returns 相邻房间名称数组
     */
    private getAdjacentRoomNames(roomName: string): string[] {
        // 解析房间名称 (例如: E10S20)
        const match = roomName.match(/([EW])(\d+)([NS])(\d+)/);
        if (!match) return [];
        
        const [, ew, x, ns, y] = match;
        const roomX = parseInt(x);
        const roomY = parseInt(y);
        
        const adjacentRooms: string[] = [];
        
        // 上下左右4个方向
        const directions = [
            { dx: 0, dy: -1 }, // 北
            { dx: 0, dy: 1 },  // 南
            { dx: -1, dy: 0 }, // 西
            { dx: 1, dy: 0 }   // 东
        ];
        
        for (const dir of directions) {
            let newX = roomX;
            let newY = roomY;
            let newEW = ew;
            let newNS = ns;
            
            // 处理X坐标
            if (dir.dx !== 0) {
                if (ew === 'E') {
                    newX = roomX + dir.dx;
                    if (newX < 0) {
                        newEW = 'W';
                        newX = Math.abs(newX) - 1;
                    }
                } else { // W
                    newX = roomX - dir.dx;
                    if (newX < 0) {
                        newEW = 'E';
                        newX = Math.abs(newX) - 1;
                    }
                }
            }
            
            // 处理Y坐标
            if (dir.dy !== 0) {
                if (ns === 'S') {
                    newY = roomY + dir.dy;
                    if (newY < 0) {
                        newNS = 'N';
                        newY = Math.abs(newY) - 1;
                    }
                } else { // N
                    newY = roomY - dir.dy;
                    if (newY < 0) {
                        newNS = 'S';
                        newY = Math.abs(newY) - 1;
                    }
                }
            }
            
            const adjacentRoomName = `${newEW}${newX}${newNS}${newY}`;
            adjacentRooms.push(adjacentRoomName);
        }
        
        return adjacentRooms;
    }

    /**
     * 检查房间是否可以进入（无控制者或属于玩家）
     * @param roomName - 房间名称
     * @returns 是否可以进入
     */
    private isRoomAccessible(roomName: string): boolean {
        const room = Game.rooms[roomName];
        if (!room) return false; // 房间不可见，无法判断
        
        // 检查房间控制者
        const controller = room.controller;
        if (!controller) {
            return true; // 无控制者的房间可以进入
        }
        
        if (controller.my) {
            return true; // 自己的房间
        }
        
        if (controller.owner) {
            return false; // 被其他玩家占领
        }
        
        // 有控制者但无拥有者（中立房间）
        return true;
    }

    /**
     * 扫描相邻房间的矿源
     */
    private scanAdjacentRooms(): void {
        const myRooms = Object.keys(Game.rooms).filter(roomName => {
            const room = Game.rooms[roomName];
            return room.controller && room.controller.my;
        });
        
        for (const roomName of myRooms) {
            // 获取相邻房间
            if (!this.adjacentRoomsCache[roomName]) {
                this.adjacentRoomsCache[roomName] = this.getAdjacentRoomNames(roomName);
            }
            
            const adjacentRooms = this.adjacentRoomsCache[roomName];
            
            for (const adjacentRoomName of adjacentRooms) {
                // 检查房间是否可访问
                if (!this.isRoomAccessible(adjacentRoomName)) {
                    continue;
                }
                
                const adjacentRoom = Game.rooms[adjacentRoomName];
                if (!adjacentRoom) {
                    // 房间不可见，尝试派遣scout
                    this.requestScout(adjacentRoomName, roomName);
                    continue;
                }
                
                // 扫描相邻房间的矿源
                const sources = adjacentRoom.find(FIND_SOURCES);
                for (const source of sources) {
                    this.scanSource(source);
                    console.log(`[HarvestPlanner] 发现相邻房间矿源：${source.id} 在 ${adjacentRoomName}`);
                }
            }
        }
    }

    /**
     * 请求派遣侦察兵到未知房间
     * @param targetRoomName - 目标房间名称
     * @param fromRoomName - 出发房间名称
     */
    private requestScout(targetRoomName: string, fromRoomName: string): void {
        // 检查是否已经在侦察
        const existingScout = _.find(Game.creeps, creep => 
            creep.memory.role === 'scout' && creep.memory.targetRoom === targetRoomName
        );
        
        if (existingScout) return; // 已有侦察兵在路上
        
        // 发射侦察请求信号
        signals.emit('scout.need_room_vision', {
            targetRoomName,
            fromRoomName,
            purpose: 'harvest_planning'
        });
        
        if (Game.time % 200 === 0) { // 每200tick提示一次
            console.log(`[HarvestPlanner] 请求侦察房间 ${targetRoomName} 寻找矿源`);
        }
    }

    /**
     * 分配矿源给creep，优先考虑本房间矿源，支持相邻房间
     */
    private assignSourceToCreep(request: HarvestRequest): string | null {
        const creep = Game.creeps[request.creepName];
        if (!creep) return null;
        
        const candidates: { sourceId: string; distance: number; freePositions: number; isLocalRoom: boolean }[] = [];
        
        // 收集候选矿源
        for (const sourceId in this.sourceDatabase) {
            const sourceData = this.sourceDatabase[sourceId];
            
            // 检查是否有空闲位置
            if (sourceData.freePositions <= 0) continue;
            
            const source = safeGetObjectById(sourceId as Id<Source>);
            if (!source) continue;
            
            const isLocalRoom = sourceData.roomName === request.roomName;
            
            // 如果不允许跨房间且不是本房间，跳过
            if (!request.allowCrossRoom && !isLocalRoom) {
                continue;
            }
            
            // 检查相邻房间是否可访问
            if (!isLocalRoom && !this.isRoomAccessible(sourceData.roomName)) {
                continue;
            }
            
            const distance = creep.pos.getRangeTo(source.pos);
            
            candidates.push({
                sourceId,
                distance,
                freePositions: sourceData.freePositions,
                isLocalRoom
            });
        }
        
        if (candidates.length === 0) return null;
        
        // 优先级排序：本房间 > 空闲位置多 > 距离近
        candidates.sort((a, b) => {
            // 首先优先本房间
            if (a.isLocalRoom !== b.isLocalRoom) {
                return a.isLocalRoom ? -1 : 1;
            }
            // 然后按空闲位置数排序（多的优先）
            if (a.freePositions !== b.freePositions) {
                return b.freePositions - a.freePositions;
            }
            // 最后按距离排序（近的优先）
            return a.distance - b.distance;
        });
        
        const selectedCandidate = candidates[0];
        const sourceData = this.sourceDatabase[selectedCandidate.sourceId];
        
        if (!selectedCandidate.isLocalRoom) {
            console.log(`[HarvestPlanner] 分配跨房间矿源：${selectedCandidate.sourceId} (${sourceData.roomName}) 给 ${request.creepName}`);
        }
        
        return selectedCandidate.sourceId;
    }

    /**
     * 调试状态输出
     */
    private debugStatus(): void {
        const totalSources = Object.keys(this.sourceDatabase).length;
        const totalRequests = this.harvestRequests.length;
        const totalAssignments = Object.keys(this.assignments).length;
        
        console.log(`[HarvestPlanner 调试] 矿源: ${totalSources}, 请求: ${totalRequests}, 分配: ${totalAssignments}`);
        
        if (totalRequests > 0) {
            console.log(`[HarvestPlanner 调试] 待处理请求:`);
            this.harvestRequests.forEach(req => {
                console.log(`  - ${req.creepName} (房间:${req.roomName}, 优先级:${req.priority}, 跨房间:${req.allowCrossRoom})`);
            });
        }
        
        if (totalSources > 0) {
            console.log(`[HarvestPlanner 调试] 矿源状态:`);
            for (const sourceId in this.sourceDatabase) {
                const sourceData = this.sourceDatabase[sourceId];
                console.log(`  - ${sourceId.substring(0, 8)}... 在 ${sourceData.roomName}: ${sourceData.freePositions}/${sourceData.totalPositions} 空闲`);
            }
        }
    }
}

/**
 * 安全地通过ID获取对象，处理可能的失效ID
 */
function safeGetObjectById<T extends _HasId>(id: Id<T> | undefined): T | null {
    if (!id) return null;
    
    try {
        return Game.getObjectById(id);
    } catch (error) {
        console.log(`[HarvestPlanner] 无法找到对象 ID: ${id}`);
        return null;
    }
}

export const harvestPlanner = new HarvestPlanner(); 
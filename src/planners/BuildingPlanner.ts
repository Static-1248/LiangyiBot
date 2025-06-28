import { signals } from '../SignalSystem';
import { memory } from '../MemoryManager';

interface FloorData {
    /** 当前tick内creep通过次数 */
    passCount: number;
    /** 上次重置计数的tick */
    lastResetTick: number;
    /** 历史通行频率（0-1之间） */
    trafficFrequency: number;
}

interface RoomTrafficData {
    /** 房间的地板通行数据，使用"x,y"作为key */
    floorData: { [coordinate: string]: FloorData };
    /** 当前tick */
    currentTick: number;
    /** 统计周期长度（ticks） */
    statisticsPeriod: number;
    /** 上次生成报告的tick */
    lastReportTick: number;
}

/**
 * 交通统计报告接口
 */
interface TrafficReport {
    roomName: string;
    reportTick: number;
    totalPositions: number;
    highTrafficPositions: Array<{
        coordinate: string;
        x: number;
        y: number;
        passCount: number;
        trafficFrequency: number;
    }>;
    top5Positions: Array<{
        coordinate: string;
        x: number;
        y: number;
        passCount: number;
        trafficFrequency: number;
        rank: number;
    }>;
    averageTraffic: number;
    maxTraffic: number;
}

/**
 * 建筑规划器
 * - 监控creep的移动轨迹
 * - 统计地板使用频率
 * - 每100tick重置统计并生成报告
 * - 自动规划高频通行路径的道路（3%阈值，前5名优先）
 */
class BuildingPlanner {
    /** 每个房间的交通数据 */
    private roomTrafficData: { [roomName: string]: RoomTrafficData } = {};
    
    /** 道路规划的阈值（3%的时间有creep通过） */
    private readonly ROAD_PLANNING_THRESHOLD = 0.03;
    
    /** 统计周期（100 ticks） */
    private readonly STATISTICS_PERIOD = 100;
    
    /** 最小道路间距（避免道路过于密集） */
    private readonly MIN_ROAD_DISTANCE = 3;
    
    /** 前N名位置考虑建造道路 */
    private readonly TOP_POSITIONS_COUNT = 5;

    constructor() {
        // 连接到tick开始信号，执行规划逻辑
        signals.connect('system.tick_start', null, () => this.run());
        
        // 监听creep移动事件（需要在主循环中调用recordCreepMovement）
        this.initializeTrafficData();
        
        console.log(`[BuildingPlanner] 建筑规划器已初始化 - 阈值:${this.ROAD_PLANNING_THRESHOLD*100}%, 周期:${this.STATISTICS_PERIOD}tick`);
    }

    /**
     * 初始化交通数据
     */
    private initializeTrafficData(): void {
        for (const roomName in Game.rooms) {
            const room = Game.rooms[roomName];
            if (!room.controller || !room.controller.my) continue;
            
            this.getOrCreateRoomTrafficData(roomName);
        }
    }

    /**
     * 获取或创建房间交通数据
     */
    private getOrCreateRoomTrafficData(roomName: string): RoomTrafficData {
        if (!this.roomTrafficData[roomName]) {
            this.roomTrafficData[roomName] = {
                floorData: {},
                currentTick: Game.time,
                statisticsPeriod: this.STATISTICS_PERIOD,
                lastReportTick: Game.time
            };
            
            // 从内存中恢复数据
            const savedData = memory.getGlobalMemory(`planner.traffic.${roomName}`);
            if (savedData) {
                this.roomTrafficData[roomName] = Object.assign({}, savedData, {
                    lastReportTick: savedData.lastReportTick || Game.time
                });
            }
        }
        return this.roomTrafficData[roomName];
    }

    /**
     * 记录creep移动
     * 需要在main loop中为每个creep调用此方法
     */
    public recordCreepMovement(creep: Creep): void {
        const roomName = creep.room.name;
        const roomTrafficData = this.getOrCreateRoomTrafficData(roomName);
        const coordinate = `${creep.pos.x},${creep.pos.y}`;
        
        // 获取或创建地板数据
        if (!roomTrafficData.floorData[coordinate]) {
            roomTrafficData.floorData[coordinate] = {
                passCount: 0,
                lastResetTick: Game.time,
                trafficFrequency: 0
            };
        }
        
        const floorData = roomTrafficData.floorData[coordinate];
        
        // 增加通过次数
        floorData.passCount++;
    }

    /**
     * 主要运行逻辑
     */
    private run(): void {
        this.recordAllCreepMovements();
        this.checkAndResetStatistics();
        this.saveTrafficData();
    }

    /**
     * 记录所有creep的移动
     */
    private recordAllCreepMovements(): void {
        for (const creepName in Game.creeps) {
            const creep = Game.creeps[creepName];
            this.recordCreepMovement(creep);
        }
    }

    /**
     * 检查并重置统计数据（每100tick）
     */
    private checkAndResetStatistics(): void {
        for (const roomName in this.roomTrafficData) {
            const room = Game.rooms[roomName];
            if (!room || !room.controller || !room.controller.my) continue;
            
            const trafficData = this.roomTrafficData[roomName];
            
            // 检查是否达到统计周期
            if (Game.time - trafficData.lastReportTick >= this.STATISTICS_PERIOD) {
                // 生成报告并规划道路
                const report = this.generateTrafficReport(roomName);
                this.displayReport(report);
                this.planRoadsFromReport(report, room);
                
                // 重置统计数据
                this.resetRoomStatistics(roomName);
            }
        }
    }

    /**
     * 生成交通统计报告
     */
    private generateTrafficReport(roomName: string): TrafficReport {
        const trafficData = this.roomTrafficData[roomName];
        const positions: Array<{
            coordinate: string;
            x: number;
            y: number;
            passCount: number;
            trafficFrequency: number;
        }> = [];
        
        let totalTraffic = 0;
        let maxTraffic = 0;
        
        // 计算每个位置的通行频率
        for (const coordinate in trafficData.floorData) {
            const floorData = trafficData.floorData[coordinate];
            const frequency = floorData.passCount / this.STATISTICS_PERIOD;
            floorData.trafficFrequency = frequency;
            
            const [x, y] = coordinate.split(',').map(Number);
            const posData = {
                coordinate,
                x,
                y,
                passCount: floorData.passCount,
                trafficFrequency: frequency
            };
            
            positions.push(posData);
            totalTraffic += frequency;
            if (frequency > maxTraffic) {
                maxTraffic = frequency;
            }
        }
        
        // 找出高流量位置（>3%）
        const highTrafficPositions = positions.filter(
            pos => pos.trafficFrequency >= this.ROAD_PLANNING_THRESHOLD
        );
        
        // 按通行频率排序，取前5名
        const top5Positions = positions
            .sort((a, b) => b.trafficFrequency - a.trafficFrequency)
            .slice(0, this.TOP_POSITIONS_COUNT)
            .map((pos, index) => Object.assign({}, pos, {
                rank: index + 1
            }));
        
        return {
            roomName,
            reportTick: Game.time,
            totalPositions: positions.length,
            highTrafficPositions,
            top5Positions,
            averageTraffic: positions.length > 0 ? totalTraffic / positions.length : 0,
            maxTraffic
        };
    }

    /**
     * 显示交通报告
     */
    private displayReport(report: TrafficReport): void {
        console.log(`\n📊 [BuildingPlanner] 房间 ${report.roomName} 交通统计报告 - Tick ${report.reportTick}`);
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
        console.log(`📈 统计概况:`);
        console.log(`   总监测位置: ${report.totalPositions}`);
        console.log(`   高流量位置: ${report.highTrafficPositions.length} (≥${this.ROAD_PLANNING_THRESHOLD*100}%)`);
        console.log(`   平均通过率: ${(report.averageTraffic*100).toFixed(2)}%`);
        console.log(`   最高通过率: ${(report.maxTraffic*100).toFixed(2)}%`);
        
        console.log(`\n🏆 通过率前5名位置:`);
        report.top5Positions.forEach((pos, index) => {
            const percentage = (pos.trafficFrequency * 100).toFixed(2);
            const status = pos.trafficFrequency >= this.ROAD_PLANNING_THRESHOLD ? "✅符合条件" : "❌低于阈值";
            console.log(`   ${pos.rank}. (${pos.x},${pos.y}) - ${percentage}% (${pos.passCount}次) ${status}`);
        });
        
        if (report.highTrafficPositions.length > 0) {
            console.log(`\n🚧 需要建路的位置 (≥${this.ROAD_PLANNING_THRESHOLD*100}% 且在前${this.TOP_POSITIONS_COUNT}名):`);
            const buildablePositions = report.top5Positions.filter(
                pos => pos.trafficFrequency >= this.ROAD_PLANNING_THRESHOLD
            );
            buildablePositions.forEach(pos => {
                console.log(`   → (${pos.x},${pos.y}) - ${(pos.trafficFrequency*100).toFixed(2)}% 第${pos.rank}名`);
            });
        } else {
            console.log(`\n💤 本周期无位置需要建路`);
        }
        console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    }

    /**
     * 根据报告规划道路建设
     */
    private planRoadsFromReport(report: TrafficReport, room: Room): void {
        // 筛选出符合条件的位置：通过率≥3%且在前5名
        const candidatePositions = report.top5Positions.filter(
            pos => pos.trafficFrequency >= this.ROAD_PLANNING_THRESHOLD
        );
        
        if (candidatePositions.length === 0) {
            return;
        }
        
        console.log(`[BuildingPlanner] 开始为房间 ${room.name} 规划 ${candidatePositions.length} 条道路`);
        
        let planned = 0;
        for (const posData of candidatePositions) {
            const pos = new RoomPosition(posData.x, posData.y, room.name);
            
            // 检查位置是否适合建造道路
            if (this.canBuildRoadAt(pos, room)) {
                const result = room.createConstructionSite(pos, STRUCTURE_ROAD);
                if (result === OK) {
                    planned++;
                    console.log(`[BuildingPlanner] ✅ 在 (${pos.x},${pos.y}) 规划道路建设`);
                    console.log(`  - 排名: 第${posData.rank}名`);
                    console.log(`  - 通行频率: ${(posData.trafficFrequency * 100).toFixed(2)}%`);
                    console.log(`  - 通过次数: ${posData.passCount}次`);
                    
                    // 发射道路规划信号
                    signals.emit('building.road_planned', {
                        roomName: room.name,
                        position: pos,
                        rank: posData.rank,
                        trafficFrequency: posData.trafficFrequency,
                        passCount: posData.passCount
                    });
                } else {
                    console.log(`[BuildingPlanner] ❌ 无法在 (${pos.x},${pos.y}) 建造道路，错误: ${result}`);
                }
            } else {
                console.log(`[BuildingPlanner] ⚠️ (${pos.x},${pos.y}) 不适合建造道路`);
            }
        }
        
        if (planned > 0) {
            signals.emit('building.construction_needed', {
                roomName: room.name,
                roadCount: planned,
                totalCandidates: candidatePositions.length
            });
        }
    }

    /**
     * 重置房间统计数据
     */
    private resetRoomStatistics(roomName: string): void {
        const trafficData = this.roomTrafficData[roomName];
        if (!trafficData) return;
        
        // 重置所有位置的计数，但保留历史频率用于参考
        for (const coordinate in trafficData.floorData) {
            const floorData = trafficData.floorData[coordinate];
            floorData.passCount = 0;
            floorData.lastResetTick = Game.time;
        }
        
        // 更新报告时间
        trafficData.lastReportTick = Game.time;
        
        console.log(`[BuildingPlanner] 🔄 已重置房间 ${roomName} 的统计数据`);
    }

    /**
     * 检查位置是否可以建造道路
     */
    private canBuildRoadAt(pos: RoomPosition, room: Room): boolean {
        // 检查地形
        const terrain = room.getTerrain();
        if (terrain.get(pos.x, pos.y) === TERRAIN_MASK_WALL) {
            return false;
        }
        
        // 检查是否已有建筑
        const structures = pos.lookFor(LOOK_STRUCTURES);
        if (structures.length > 0) {
            // 如果已经是道路或其他建筑，直接返回false
            const hasRoad = structures.some(s => s.structureType === STRUCTURE_ROAD);
            const hasOtherStructure = structures.some(s => s.structureType !== STRUCTURE_ROAD);
            
            if (hasRoad) {
                console.log(`[BuildingPlanner] ⚠️ (${pos.x},${pos.y}) 已经是道路，跳过`);
                return false;
            }
            if (hasOtherStructure) {
                console.log(`[BuildingPlanner] ⚠️ (${pos.x},${pos.y}) 已有其他建筑，跳过`);
                return false;
            }
        }
        
        // 检查是否已有建设任务
        const constructionSites = pos.lookFor(LOOK_CONSTRUCTION_SITES);
        if (constructionSites.length > 0) {
            const hasRoadSite = constructionSites.some(s => s.structureType === STRUCTURE_ROAD);
            if (hasRoadSite) {
                console.log(`[BuildingPlanner] ⚠️ (${pos.x},${pos.y}) 已有道路建设任务，跳过`);
            }
            return false;
        }
        
        // 检查与现有道路的距离
        return this.checkMinimumRoadDistance(pos, room);
    }

    /**
     * 检查与现有道路的最小距离
     */
    private checkMinimumRoadDistance(pos: RoomPosition, room: Room): boolean {
        const roads = room.find(FIND_STRUCTURES, {
            filter: s => s.structureType === STRUCTURE_ROAD
        });
        
        for (const road of roads) {
            if (pos.getRangeTo(road.pos) < this.MIN_ROAD_DISTANCE) {
                return false;
            }
        }
        
        return true;
    }

    /**
     * 保存交通数据到内存
     */
    private saveTrafficData(): void {
        for (const roomName in this.roomTrafficData) {
            memory.setGlobalMemory(`planner.traffic.${roomName}`, this.roomTrafficData[roomName]);
        }
    }

    /**
     * 获取房间交通统计信息
     */
    public getRoomTrafficStats(roomName: string): any {
        const trafficData = this.roomTrafficData[roomName];
        if (!trafficData) return null;
        
        let totalPositions = 0;
        let highTrafficPositions = 0;
        let maxFrequency = 0;
        let totalTraffic = 0;
        
        for (const coordinate in trafficData.floorData) {
            const floorData = trafficData.floorData[coordinate];
            totalPositions++;
            totalTraffic += floorData.trafficFrequency;
            
            if (floorData.trafficFrequency >= this.ROAD_PLANNING_THRESHOLD) {
                highTrafficPositions++;
            }
            
            if (floorData.trafficFrequency > maxFrequency) {
                maxFrequency = floorData.trafficFrequency;
            }
        }
        
        return {
            roomName,
            totalPositions,
            highTrafficPositions,
            maxFrequency: Math.round(maxFrequency * 100) / 100,
            averageFrequency: totalPositions > 0 ? Math.round((totalTraffic / totalPositions) * 100) / 100 : 0,
            threshold: this.ROAD_PLANNING_THRESHOLD,
            statisticsPeriod: this.STATISTICS_PERIOD,
            lastReportTick: trafficData.lastReportTick,
            nextReportIn: this.STATISTICS_PERIOD - (Game.time - trafficData.lastReportTick)
        };
    }

    /**
     * 手动触发房间统计重置和报告生成
     */
    public forceReportGeneration(roomName: string): void {
        const room = Game.rooms[roomName];
        if (!room || !room.controller || !room.controller.my) {
            console.log(`[BuildingPlanner] 房间 ${roomName} 不存在或不属于您`);
            return;
        }
        
        console.log(`[BuildingPlanner] 手动触发房间 ${roomName} 的报告生成`);
        const report = this.generateTrafficReport(roomName);
        this.displayReport(report);
        this.planRoadsFromReport(report, room);
        this.resetRoomStatistics(roomName);
    }

    /**
     * 重置房间交通数据
     */
    public resetRoomTrafficData(roomName: string): void {
        delete this.roomTrafficData[roomName];
        memory.deleteGlobalMemory(`planner.traffic.${roomName}`);
        console.log(`[BuildingPlanner] 已完全重置房间 ${roomName} 的交通数据`);
    }
}

export const buildingPlanner = new BuildingPlanner(); 
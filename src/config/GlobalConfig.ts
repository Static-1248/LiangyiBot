/**
 * 全局配置系统
 */
import { memory } from '../MemoryManager';

// Creep角色配置接口
export interface CreepRoleConfig {
    bodyParts: BodyPartConstant[][];  // 不同等级的身体部件配置
    maxCount: number;                 // 房间最大数量
    priority: number;                 // 生产优先级（数字越小优先级越高）
    minEnergyCapacity: number;        // 最小能量容量要求
    description: string;              // 描述
}

// 房间配置接口
export interface RoomConfig {
    creepCounts: { [role: string]: number };  // 各角色数量限制
    autoSpawn: boolean;                       // 是否自动生成
    defenseLevel: number;                     // 防御等级
    buildingPriority: string[];               // 建筑优先级
}

// 全局配置接口
export interface GlobalConfigData {
    creepRoles: { [role: string]: CreepRoleConfig };
    rooms: { [roomName: string]: RoomConfig };
    general: {
        enableAutoSpawn: boolean;
        maxCPUUsage: number;
        logLevel: number;
        tickInterval: number;
    };
    version: string;
}

export class GlobalConfig {
    private static instance: GlobalConfig;
    private configData: GlobalConfigData;

    private constructor() {
        // 默认配置
        const defaultConfig: GlobalConfigData = {
            creepRoles: {
                'upgrader': {
                    bodyParts: [
                        [WORK, CARRY, MOVE],
                        [WORK, WORK, CARRY, MOVE],
                        [WORK, WORK, CARRY, CARRY, MOVE, MOVE],
                        [WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE],
                        [WORK, WORK, WORK, WORK, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE]
                    ],
                    maxCount: 3,
                    priority: 1,  // 最高优先级
                    minEnergyCapacity: 200,
                    description: '升级房间控制器'
                },
                'builder': {
                    bodyParts: [
                        [WORK, CARRY, MOVE],
                        [WORK, WORK, CARRY, MOVE],
                        [WORK, WORK, CARRY, CARRY, MOVE, MOVE],
                        [WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE],
                        [WORK, WORK, WORK, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE]
                    ],
                    maxCount: 2,
                    priority: 3,
                    minEnergyCapacity: 200,
                    description: '建造和修理建筑'
                },
                'miner': {
                    bodyParts: [
                        [WORK, WORK, MOVE],
                        [WORK, WORK, WORK, MOVE, MOVE],
                        [WORK, WORK, WORK, WORK, MOVE, MOVE, MOVE],
                        [WORK, WORK, WORK, WORK, WORK, MOVE, MOVE, MOVE, MOVE],
                        [WORK, WORK, WORK, WORK, WORK, WORK, MOVE, MOVE, MOVE, MOVE, MOVE]
                    ],
                    maxCount: 2,  // 每个source一个
                    priority: 2,
                    minEnergyCapacity: 250,
                    description: '采集资源放入容器'
                },
                'hauler': {
                    bodyParts: [
                        [CARRY, CARRY, MOVE],
                        [CARRY, CARRY, CARRY, MOVE, MOVE],
                        [CARRY, CARRY, CARRY, CARRY, MOVE, MOVE],
                        [CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE],
                        [CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE]
                    ],
                    maxCount: 3,
                    priority: 4,
                    minEnergyCapacity: 150,
                    description: '搬运资源'
                },
                'supplier': {
                    bodyParts: [
                        [CARRY, CARRY, MOVE],
                        [CARRY, CARRY, CARRY, MOVE, MOVE],
                        [CARRY, CARRY, CARRY, CARRY, MOVE, MOVE],
                        [CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE],
                        [CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE, MOVE]
                    ],
                    maxCount: 2,
                    priority: 2,
                    minEnergyCapacity: 150,
                    description: '为spawn和扩展充能'
                }
            },
            rooms: {},
            general: {
                enableAutoSpawn: true,
                maxCPUUsage: 80,
                logLevel: 2,
                tickInterval: 1
            },
            version: '1.0.0'
        };

        // 从内存加载配置
        this.configData = memory.getGlobalMemory('config.global', defaultConfig);
        
        // 如果版本不匹配，更新配置
        if (this.configData.version !== defaultConfig.version) {
            this.configData = Object.assign({}, defaultConfig, this.configData);
            this.configData.version = defaultConfig.version;
            this.saveConfig();
        }
    }

    public static getInstance(): GlobalConfig {
        if (!GlobalConfig.instance) {
            GlobalConfig.instance = new GlobalConfig();
        }
        return GlobalConfig.instance;
    }

    /**
     * 获取creep角色配置
     */
    public getCreepRoleConfig(role: string): CreepRoleConfig | null {
        return this.configData.creepRoles[role] || null;
    }

    /**
     * 获取适合当前能量容量的身体部件
     */
    public getBodyParts(role: string, energyCapacity: number): BodyPartConstant[] {
        const config = this.getCreepRoleConfig(role);
        if (!config) return [WORK, CARRY, MOVE];

        // 找到适合当前能量容量的最大身体配置
        let bestBodyParts = config.bodyParts[0];
        
        for (const bodyParts of config.bodyParts) {
            const cost = this.calculateBodyCost(bodyParts);
            if (cost <= energyCapacity) {
                bestBodyParts = bodyParts;
            } else {
                break;
            }
        }

        return bestBodyParts;
    }

    /**
     * 计算身体部件成本
     */
    public calculateBodyCost(bodyParts: BodyPartConstant[]): number {
        return bodyParts.reduce((cost, part) => cost + BODYPART_COST[part], 0);
    }

    /**
     * 获取房间配置
     */
    public getRoomConfig(roomName: string): RoomConfig {
        if (!this.configData.rooms[roomName]) {
            // 创建默认房间配置
            this.configData.rooms[roomName] = {
                creepCounts: {},
                autoSpawn: true,
                defenseLevel: 1,
                buildingPriority: ['spawn', 'extension', 'tower', 'storage', 'container']
            };
            this.saveConfig();
        }
        return this.configData.rooms[roomName];
    }

    /**
     * 获取房间creep数量限制
     */
    public getRoomCreepLimit(roomName: string, role: string): number {
        const roomConfig = this.getRoomConfig(roomName);
        const roleConfig = this.getCreepRoleConfig(role);
        
        // 房间特定限制优先，否则使用全局配置
        return roomConfig.creepCounts[role] || roleConfig?.maxCount || 1;
    }

    /**
     * 设置房间creep数量限制
     */
    public setRoomCreepLimit(roomName: string, role: string, count: number): void {
        const roomConfig = this.getRoomConfig(roomName);
        roomConfig.creepCounts[role] = count;
        this.saveConfig();
    }

    /**
     * 获取所有角色按优先级排序
     */
    public getRolesByPriority(): string[] {
        return Object.keys(this.configData.creepRoles)
            .sort((a, b) => {
                const priorityA = this.configData.creepRoles[a].priority;
                const priorityB = this.configData.creepRoles[b].priority;
                return priorityA - priorityB;
            });
    }

    /**
     * 检查房间是否有spawn
     */
    public roomHasSpawn(roomName: string): boolean {
        const room = Game.rooms[roomName];
        if (!room) return false;
        
        const spawns = room.find(FIND_MY_SPAWNS);
        return spawns.length > 0;
    }

    /**
     * 获取upgrader特殊规则数量
     */
    public getUpgraderCount(roomName: string): number {
        const room = Game.rooms[roomName];
        if (!room || !room.controller || !room.controller.my) return 0;

        // 如果房间有spawn，至少需要2个upgrader
        if (this.roomHasSpawn(roomName)) {
            return Math.max(2, this.getRoomCreepLimit(roomName, 'upgrader'));
        }

        return this.getRoomCreepLimit(roomName, 'upgrader');
    }

    /**
     * 获取miner数量（基于source数量）
     */
    public getMinerCount(roomName: string): number {
        const room = Game.rooms[roomName];
        if (!room) return 0;

        const sources = room.find(FIND_SOURCES);
        return Math.min(sources.length, this.getRoomCreepLimit(roomName, 'miner'));
    }

    /**
     * 获取通用配置
     */
    public getGeneralConfig() {
        return this.configData.general;
    }

    /**
     * 更新creep角色配置
     */
    public updateCreepRoleConfig(role: string, config: Partial<CreepRoleConfig>): void {
        if (this.configData.creepRoles[role]) {
            this.configData.creepRoles[role] = Object.assign({}, this.configData.creepRoles[role], config);
        } else {
            this.configData.creepRoles[role] = config as CreepRoleConfig;
        }
        this.saveConfig();
    }

    /**
     * 保存配置到内存
     */
    private saveConfig(): void {
        memory.setGlobalMemory('config.global', this.configData);
    }

    /**
     * 重置配置为默认值
     */
    public resetToDefaults(): void {
        memory.deleteGlobalMemory('config.global');
        GlobalConfig.instance = new GlobalConfig();
    }

    /**
     * 获取完整配置数据（用于调试）
     */
    public getFullConfig(): GlobalConfigData {
        return JSON.parse(JSON.stringify(this.configData));
    }

    /**
     * 导出配置
     */
    public exportConfig(): string {
        return JSON.stringify(this.configData, null, 2);
    }

    /**
     * 导入配置
     */
    public importConfig(configJson: string): boolean {
        try {
            const newConfig = JSON.parse(configJson);
            this.configData = newConfig;
            this.saveConfig();
            return true;
        } catch (error) {
            console.log('配置导入失败:', error);
            return false;
        }
    }
}

// 全局配置实例
export const globalConfig = GlobalConfig.getInstance(); 
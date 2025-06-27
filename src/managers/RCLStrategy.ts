/**
 * RCL策略管理器 - 根据房间控制器等级决定游戏策略
 */

export interface CreepConfig {
    enabled: boolean;
    maxCount: number;
    priority: number;
    bodyTemplate: BodyPartConstant[][];
}

export interface RCLStrategyConfig {
    supplier: CreepConfig;
    upgrader: CreepConfig;
    hauler: CreepConfig;
    miner: CreepConfig;
    builder: CreepConfig;
}

/**
 * RCL策略管理器
 */
export class RCLStrategy {
    /**
     * 计算房间的creep数量限制
     * @param rcl - 房间控制器等级
     * @returns 每种creep的最大数量
     */
    static getCreepLimit(rcl: number): number {
        return Math.max(5, Math.floor(3 * Math.pow(rcl, 1.5)));
    }

    /**
     * 获取指定RCL等级的策略配置
     * @param rcl - 房间控制器等级
     * @returns 策略配置
     */
    static getStrategy(rcl: number): RCLStrategyConfig {
        const creepLimit = this.getCreepLimit(rcl);
        
        // RCL 1-3: 只有supplier和upgrader，直接从source采集
        if (rcl <= 3) {
            return {
                supplier: {
                    enabled: true,
                    maxCount: Math.min(creepLimit, 2), // 最多2个supplier
                    priority: 1, // 最高优先级
                    bodyTemplate: this.getBodyTemplate('supplier', rcl)
                },
                upgrader: {
                    enabled: true,
                    maxCount: Math.min(creepLimit, 3), // 最多3个upgrader
                    priority: 2,
                    bodyTemplate: this.getBodyTemplate('upgrader', rcl)
                },
                hauler: { enabled: false, maxCount: 0, priority: 99, bodyTemplate: [] },
                miner: { enabled: false, maxCount: 0, priority: 99, bodyTemplate: [] },
                builder: {
                    enabled: true,
                    maxCount: Math.min(creepLimit, 1), // 最多1个builder
                    priority: 5, // 最低优先级
                    bodyTemplate: this.getBodyTemplate('builder', rcl)
                }
            };
        }
        
        // RCL 4+: 启用miner和hauler系统
        return {
            supplier: {
                enabled: true,
                maxCount: Math.min(creepLimit, 2),
                priority: 1,
                bodyTemplate: this.getBodyTemplate('supplier', rcl)
            },
            upgrader: {
                enabled: true,
                maxCount: Math.min(creepLimit, 2),
                priority: 2,
                bodyTemplate: this.getBodyTemplate('upgrader', rcl)
            },
            hauler: {
                enabled: true,
                maxCount: Math.min(creepLimit, 2),
                priority: 3,
                bodyTemplate: this.getBodyTemplate('hauler', rcl)
            },
            miner: {
                enabled: true,
                maxCount: Math.min(creepLimit, 2), // 每个source一个
                priority: 4,
                bodyTemplate: this.getBodyTemplate('miner', rcl)
            },
            builder: {
                enabled: true,
                maxCount: Math.min(creepLimit, 2),
                priority: 5,
                bodyTemplate: this.getBodyTemplate('builder', rcl)
            }
        };
    }

    /**
     * 获取指定角色和RCL的身体部件模板
     * @param role - creep角色
     * @param rcl - 房间控制器等级
     * @returns 身体部件模板数组
     */
    static getBodyTemplate(role: string, rcl: number): BodyPartConstant[][] {
        switch (role) {
            case 'supplier':
                if (rcl <= 2) return [[WORK, CARRY, MOVE], [WORK, CARRY, CARRY, MOVE, MOVE]];
                if (rcl <= 4) return [[WORK, CARRY, CARRY, MOVE, MOVE], [WORK, WORK, CARRY, CARRY, MOVE, MOVE]];
                return [[WORK, WORK, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE], [WORK, WORK, WORK, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE]];

            case 'upgrader':
                if (rcl <= 2) return [[WORK, CARRY, MOVE], [WORK, WORK, CARRY, MOVE]];
                if (rcl <= 4) return [[WORK, WORK, CARRY, MOVE], [WORK, WORK, WORK, CARRY, MOVE, MOVE]];
                return [[WORK, WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE], [WORK, WORK, WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE]];

            case 'miner':
                if (rcl <= 4) return [[WORK, WORK, CARRY, MOVE]];
                if (rcl <= 6) return [[WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE]];
                return [[WORK, WORK, WORK, WORK, WORK, CARRY, CARRY, MOVE, MOVE]];

            case 'hauler':
                if (rcl <= 4) return [[CARRY, CARRY, MOVE, MOVE]];
                if (rcl <= 6) return [[CARRY, CARRY, CARRY, CARRY, MOVE, MOVE]];
                return [[CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE]];

            case 'builder':
                if (rcl <= 2) return [[WORK, CARRY, MOVE]];
                if (rcl <= 4) return [[WORK, WORK, CARRY, CARRY, MOVE, MOVE]];
                return [[WORK, WORK, WORK, CARRY, CARRY, CARRY, MOVE, MOVE, MOVE]];

            default:
                return [[WORK, CARRY, MOVE]];
        }
    }

    /**
     * 检查房间是否应该启用容器系统
     * @param rcl - 房间控制器等级
     * @returns 是否启用容器系统
     */
    static shouldUseContainers(rcl: number): boolean {
        return rcl >= 4;
    }

    /**
     * 检查房间是否应该启用存储系统
     * @param rcl - 房间控制器等级
     * @returns 是否启用存储系统
     */
    static shouldUseStorage(rcl: number): boolean {
        return rcl >= 4;
    }

    /**
     * 获取房间在当前RCL下的源点分配策略
     * @param rcl - 房间控制器等级
     * @param sourceCount - 房间中的源点数量
     * @returns 源点分配策略
     */
    static getSourceStrategy(rcl: number, sourceCount: number): { minersPerSource: number, suppliersPerSource: number } {
        if (rcl <= 3) {
            // 早期游戏：supplier直接从source采集
            return {
                minersPerSource: 0,
                suppliersPerSource: 1
            };
        } else {
            // 中后期游戏：miner采集，hauler运输
            return {
                minersPerSource: 1,
                suppliersPerSource: 0
            };
        }
    }
} 
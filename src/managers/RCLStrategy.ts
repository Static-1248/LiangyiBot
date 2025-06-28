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
                    maxCount: Math.min(creepLimit, 2 + rcl), // 2 + RCL
                    priority: 1, // 最高优先级
                    bodyTemplate: this.getBodyTemplate('supplier', rcl)
                },
                upgrader: {
                    enabled: true,
                    maxCount: Math.min(creepLimit, 3), // 固定3个
                    priority: 2,
                    bodyTemplate: this.getBodyTemplate('upgrader', rcl)
                },
                hauler: { enabled: false, maxCount: 0, priority: 99, bodyTemplate: [] },
                miner: { enabled: false, maxCount: 0, priority: 99, bodyTemplate: [] },
                builder: {
                    enabled: true,
                    maxCount: Math.min(creepLimit, 3 + rcl * 2), // 3 + RCL * 2
                    priority: 5, // 最低优先级
                    bodyTemplate: this.getBodyTemplate('builder', rcl)
                }
            };
        }
        
        // RCL 4+: 启用miner和hauler系统
        return {
            supplier: {
                enabled: true,
                maxCount: Math.min(creepLimit, 2 + rcl), // 2 + RCL
                priority: 1,
                bodyTemplate: this.getBodyTemplate('supplier', rcl)
            },
            upgrader: {
                enabled: true,
                maxCount: Math.min(creepLimit, 3), // 固定3个
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
                maxCount: Math.min(creepLimit, 3 + rcl * 2), // 3 + RCL * 2
                priority: 5,
                bodyTemplate: this.getBodyTemplate('builder', rcl)
            }
        };
    }

    /**
     * 获取指定角色的身体部件模板
     * @param role - creep角色
     * @param rcl - 房间控制器等级（保留参数兼容性，但不影响身体配置）
     * @returns 身体部件模板数组
     */
    static getBodyTemplate(role: string, rcl: number): BodyPartConstant[][] {
        // 标准化的能量预算数组（不依赖RCL）
        const energyBudgets = [200, 300, 550, 800, 1300, 1800, 2300];
        const templates: BodyPartConstant[][] = [];
        
        for (const budget of energyBudgets) {
            const body = this.generateOptimalBody(role, budget);
            if (body.length > 0) {
                templates.push(body);
            }
        }
        
        return templates.length > 0 ? templates : [[WORK, CARRY, MOVE]]; // 至少返回基础配置
    }

    /**
     * 根据RCL等级获取能量预算数组（已废弃，保留兼容性）
     * @param rcl - 房间控制器等级
     * @returns 能量预算数组（从小到大）
     * @deprecated 身体配置现在只依赖于可用能量，不依赖RCL
     */
    private static getEnergyBudgets(rcl: number): number[] {
        // 返回标准化的能量预算，不再依赖RCL
        return [200, 300, 550, 800, 1300, 1800, 2300];
    }

    /**
     * 为指定角色和能量预算生成最优身体配置
     * 
     * 重要约束：所有creep必须满足 work >= carry/3 （即 carry <= work * 3）
     * 这确保了creep有足够的工作能力相对于其载运能力，避免效率低下的配置
     * 
     * @param role - creep角色
     * @param energyBudget - 能量预算
     * @returns 身体部件数组
     */
    private static generateOptimalBody(role: string, energyBudget: number): BodyPartConstant[] {
        const partCosts: Partial<Record<BodyPartConstant, number>> = { 
            [WORK]: 100, 
            [CARRY]: 50, 
            [MOVE]: 50 
        };
        
        switch (role) {
            case 'supplier':
                return this.generateWorkerBody(energyBudget, 1, 3, partCosts); // 1:3 work:carry比例
            
            case 'upgrader':
                return this.generateWorkerBody(energyBudget, 2, 1, partCosts); // 2:1 work:carry比例
            
            case 'miner':
                return this.generateMinerBody(energyBudget, partCosts);
            
            case 'hauler':
                return this.generateHaulerBody(energyBudget, partCosts);
            
            case 'builder':
                return this.generateWorkerBody(energyBudget, 1, 2, partCosts); // 1:2 work:carry比例
            
            default:
                return this.generateWorkerBody(energyBudget, 1, 1, partCosts); // 1:1 work:carry比例
        }
    }

    /**
     * 生成工作型creep的身体配置（supplier, upgrader, builder）
     * @param energyBudget - 能量预算
     * @param workRatio - work部件比例
     * @param carryRatio - carry部件比例
     * @param partCosts - 部件成本
     * @returns 身体部件数组
     */
    private static generateWorkerBody(
        energyBudget: number, 
        workRatio: number, 
        carryRatio: number, 
        partCosts: Partial<Record<BodyPartConstant, number>>
    ): BodyPartConstant[] {
        const body: BodyPartConstant[] = [];
        let remainingEnergy = energyBudget;
        
        // 确保至少有基础配置
        const minCost = (partCosts[WORK] || 0) + (partCosts[CARRY] || 0) + (partCosts[MOVE] || 0);
        if (remainingEnergy < minCost) {
            return [];
        }
        
        // 先添加至少一个WORK部件（工作型creep必须有）
        body.push(WORK);
        remainingEnergy -= partCosts[WORK] || 0;
        
        // 添加至少一个CARRY部件
        body.push(CARRY);
        remainingEnergy -= partCosts[CARRY] || 0;
        
        // 添加至少一个MOVE部件
        body.push(MOVE);
        remainingEnergy -= partCosts[MOVE] || 0;
        
        // 现在按比例添加更多部件
        while (remainingEnergy > 0 && body.length < 50) {
            let addedPart = false;
            
            const currentWork = body.filter(p => p === WORK).length;
            const currentCarry = body.filter(p => p === CARRY).length;
            const currentMove = body.filter(p => p === MOVE).length;
            
            // 检查work >= carry/3约束（即carry <= work * 3）
            const maxAllowedCarry = currentWork * 3;
            
            // 计算理想的部件数量
            const totalUnits = Math.min(currentWork, currentCarry);
            const idealWork = Math.max(1, Math.floor(totalUnits * workRatio / Math.max(workRatio, carryRatio)));
            const idealCarry = Math.max(1, Math.floor(totalUnits * carryRatio / Math.max(workRatio, carryRatio)));
            
            // 优先添加缺少的WORK部件（但不超过CARRY数量）
            if (currentWork < idealWork && currentWork < currentCarry && 
                remainingEnergy >= (partCosts[WORK] || 0) && body.length < 50) {
                body.push(WORK);
                remainingEnergy -= partCosts[WORK] || 0;
                addedPart = true;
            }
            // 然后添加CARRY部件（但必须符合work >= carry/3约束）
            else if ((currentCarry < idealCarry || (currentWork >= currentCarry && remainingEnergy >= (partCosts[CARRY] || 0))) &&
                     currentCarry < maxAllowedCarry) {
                if (remainingEnergy >= (partCosts[CARRY] || 0) && body.length < 50) {
                    body.push(CARRY);
                    remainingEnergy -= partCosts[CARRY] || 0;
                    addedPart = true;
                }
            }
            
            // 检查是否需要添加MOVE部件
            const newWork = body.filter(p => p === WORK).length;
            const newCarry = body.filter(p => p === CARRY).length;
            const neededMoves = newWork + Math.floor(newCarry / 2);
            
            if (currentMove < neededMoves && remainingEnergy >= (partCosts[MOVE] || 0) && body.length < 50) {
                body.push(MOVE);
                remainingEnergy -= partCosts[MOVE] || 0;
                addedPart = true;
            }
            
            // 如果没有添加任何部件，尝试添加额外的CARRY部件（但必须符合约束）
            if (!addedPart && remainingEnergy >= (partCosts[CARRY] || 0) && body.length < 50) {
                const updatedWork = body.filter(p => p === WORK).length;
                const updatedCarry = body.filter(p => p === CARRY).length;
                const updatedMaxAllowedCarry = updatedWork * 3;
                
                // 只有在不违反work >= carry/3约束时才添加carry部件
                if (updatedCarry < updatedMaxAllowedCarry) {
                    body.push(CARRY);
                    remainingEnergy -= partCosts[CARRY] || 0;
                    addedPart = true;
                    
                    // 检查是否需要额外的MOVE部件
                    const finalCarry = body.filter(p => p === CARRY).length;
                    const finalWork = body.filter(p => p === WORK).length;
                    const finalMove = body.filter(p => p === MOVE).length;
                    const finalNeededMoves = finalWork + Math.floor(finalCarry / 2);
                    
                    if (finalMove < finalNeededMoves && remainingEnergy >= (partCosts[MOVE] || 0) && body.length < 50) {
                        body.push(MOVE);
                        remainingEnergy -= partCosts[MOVE] || 0;
                    }
                }
            }
            
            // 如果无法添加任何部件，退出循环
            if (!addedPart) {
                break;
            }
        }
        
        return body;
    }

    /**
     * 生成矿工的身体配置
     * @param energyBudget - 能量预算
     * @param partCosts - 部件成本
     * @returns 身体部件数组
     */
    private static generateMinerBody(energyBudget: number, partCosts: Partial<Record<BodyPartConstant, number>>): BodyPartConstant[] {
        const body: BodyPartConstant[] = [];
        let remainingEnergy = energyBudget;
        
        // 矿工优先work部件，最多5个work（一个source的最大输出）
        const maxWork = 5;
        let workCount = 0;
        
        // 添加work部件
        while (workCount < maxWork && remainingEnergy >= (partCosts[WORK] || 0) + (partCosts[CARRY] || 0) + (partCosts[MOVE] || 0) && body.length < 47) {
            body.push(WORK);
            remainingEnergy -= partCosts[WORK] || 0;
            workCount++;
        }
        
        // 添加carry部件（至少和work一样多）
        let carryCount = 0;
        while (carryCount < workCount && remainingEnergy >= (partCosts[CARRY] || 0) && body.length < 49) {
            body.push(CARRY);
            remainingEnergy -= partCosts[CARRY] || 0;
            carryCount++;
        }
        
        // 添加额外的carry部件（但必须符合work >= carry/3约束）
        const maxAllowedCarry = workCount * 3;
        while (carryCount < maxAllowedCarry && remainingEnergy >= (partCosts[CARRY] || 0) && body.length < 49) {
            body.push(CARRY);
            remainingEnergy -= partCosts[CARRY] || 0;
            carryCount++;
        }
        
        // 计算需要的move部件
        const neededMoves = workCount + Math.floor(carryCount / 2);
        
        // 添加move部件
        for (let i = 0; i < neededMoves && body.length < 50 && remainingEnergy >= (partCosts[MOVE] || 0); i++) {
            body.push(MOVE);
            remainingEnergy -= partCosts[MOVE] || 0;
        }
        
        return body.length > 0 ? body : [WORK, CARRY, MOVE];
    }

    /**
     * 生成搬运工的身体配置
     * @param energyBudget - 能量预算
     * @param partCosts - 部件成本
     * @returns 身体部件数组
     */
    private static generateHaulerBody(energyBudget: number, partCosts: Partial<Record<BodyPartConstant, number>>): BodyPartConstant[] {
        const body: BodyPartConstant[] = [];
        let remainingEnergy = energyBudget;
        
        // 搬运工只需要carry和move
        let carryCount = 0;
        
        // 添加carry部件
        while (remainingEnergy >= (partCosts[CARRY] || 0) + ((partCosts[MOVE] || 0) / 2) && body.length < 49) {
            body.push(CARRY);
            remainingEnergy -= partCosts[CARRY] || 0;
            carryCount++;
        }
        
        // 计算需要的move部件
        const neededMoves = Math.floor(carryCount / 2);
        
        // 添加move部件
        for (let i = 0; i < neededMoves && body.length < 50 && remainingEnergy >= (partCosts[MOVE] || 0); i++) {
            body.push(MOVE);
            remainingEnergy -= partCosts[MOVE] || 0;
        }
        
        return body.length > 0 ? body : [CARRY, CARRY, MOVE];
    }

    /**
     * 计算move部件的成本
     * @param workRatio - work部件比例
     * @param carryRatio - carry部件比例
     * @param partCosts - 部件成本
     * @returns move部件成本
     */
    private static calculateMoveCost(
        workRatio: number, 
        carryRatio: number, 
        partCosts: Partial<Record<BodyPartConstant, number>>
    ): number {
        const movesNeeded = workRatio + Math.floor(carryRatio / 2);
        return movesNeeded * (partCosts[MOVE] || 0);
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
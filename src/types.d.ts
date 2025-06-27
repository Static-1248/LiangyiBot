// 扩展Screeps的Memory和CreepMemory接口
declare global {
    interface Memory {
        eventSystemInitialized?: boolean;
        // 可以在这里添加更多自定义的Memory属性
    }

    interface CreepMemory {
        role: string;
        state?: string;
        target?: Id<any>;
        targetPos?: RoomPosition;
        task?: string;
        lastAction?: string;
        born?: number;
        [key: string]: any;
    }
}

export {}; 
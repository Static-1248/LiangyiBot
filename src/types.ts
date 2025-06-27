

declare global {
    interface CreepMemory {
        role: string;
        targetRoom?: string;
    }
}

type CreepRecipe = BodyPartConstant[];

export {CreepRecipe};
export const WARDROBE_LAYERS = {
  color: ["mint", "coral", "amber", "sky", "lilac", "royal", "aqua", "graphite", "snow"],
  texture: ["layers", "gloss", "matte", "rough", "marble", "carbon"],
  pose: ["stand", "wave", "cheer", "think", "present", "idea"],
  outfit: ["none", "sweater", "overall", "apron", "labcoat", "techvest"],
  hat: ["none", "helmet", "cap", "crown", "cat", "fox", "beanie"],
  eyes: ["dots", "happy", "wink", "visor", "sleepy", "stars"],
  beard: ["none", "stubble", "moustache", "full", "braid"],
  arms: ["plain", "gloves", "sleeves", "robot"],
  accessory: ["none", "spatula", "wrench", "heart", "caliper", "solder"],
  back: ["none", "spool", "jetpack"],
} as const;

export type WardrobeLayer = keyof typeof WARDROBE_LAYERS;

export interface Achievement {
  readonly slug: string;
  readonly title: string;
  readonly description: string;
  readonly granted_at: string;
}

export interface WardrobeRewardDefinition {
  readonly layer: WardrobeLayer;
  readonly option_id: string;
  readonly slug: string;
}

export interface EarnedAchievement {
  readonly slug: string;
  readonly granted_at: string;
}

export interface GrantedWardrobeReward {
  readonly achievement_slug: string;
  readonly layer: WardrobeLayer;
  readonly option_id: string;
  readonly granted_at: string;
}

export type WardrobeUnlockLayers = Record<WardrobeLayer, string[]>;

export interface WardrobeUnlocks {
  readonly layers: WardrobeUnlockLayers;
  readonly rewards: readonly GrantedWardrobeReward[];
}

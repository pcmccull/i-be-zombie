// [pure] Data-driven catalog for cosmetics, companions, vehicles, hideouts, trophies, secrets, and achievements.
// Spec: docs/11_cityupgrade.md §4.
import type {
  CompanionId,
  CosmeticSlot,
  DistrictId,
  HideoutId,
  PlayerVehicleKind,
  RewardDefinition,
  StrongholdId,
  Vec2,
} from '../core/types';

export interface CompanionDef {
  id: CompanionId;
  name: string;
  title: string;
  districtId: DistrictId;
  unlockPos: Vec2;
  description: string;
  perkLabel: string;
  rewardId: string;
}

export interface HideoutDef {
  id: HideoutId;
  name: string;
  districtId: DistrictId;
  strongholdId: StrongholdId | null;
  pos: Vec2;
  description: string;
  rewardId: string;
}

export interface SecretDef {
  id: string;
  title: string;
  districtId: DistrictId;
  pos: Vec2;
  radius: number;
  brainsReward: number;
  rewardId: string | null;
  description: string;
  /** Shortcut secrets: once discovered, interact at `pos` or `shortcutTo` to travel to the other end. */
  shortcutTo?: Vec2;
}

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  statKey: string;
  threshold: number;
  rewardId: string;
  brainsBonus: number;
}

export const REWARDS: readonly RewardDefinition[] = [
  // --- Cosmetics (Alpha starts with none equipped, preserving silhouette) ---
  {
    id: 'cos_traffic_cone',
    type: 'cosmetic',
    displayName: 'Traffic-Cone Hat',
    description: 'Peak Miami road-safety fashion.',
    slot: 'hat',
    iconId: 'hat',
    assetId: 'traffic_cone',
    unique: true,
    sourceIds: ['ach_road_rage'],
    costBrains: 25,
  },
  {
    id: 'cos_chef_hat',
    type: 'cosmetic',
    displayName: 'Chef Toque',
    description: 'Compliments to the undead chef.',
    slot: 'hat',
    iconId: 'hat',
    assetId: 'chef_hat',
    unique: true,
    sourceIds: ['ach_fine_dining'],
    costBrains: 30,
  },
  {
    id: 'cos_beach_visor',
    type: 'cosmetic',
    displayName: 'Tropical Sun Visor',
    description: 'Keeps the noon glare out of mismatched eyes.',
    slot: 'hat',
    iconId: 'hat',
    assetId: 'beach_visor',
    unique: true,
    sourceIds: ['shop_wardrobe'],
    costBrains: 20,
  },
  {
    id: 'cos_oversized_shades',
    type: 'cosmetic',
    displayName: 'Oversized Sunglasses',
    description: 'Celebrity disguise for casual boardwalk strolling.',
    slot: 'glasses',
    iconId: 'glasses',
    assetId: 'oversized_shades',
    unique: true,
    sourceIds: ['ach_tourist_trap'],
    costBrains: 30,
  },
  {
    id: 'cos_neon_shades',
    type: 'cosmetic',
    displayName: 'Neon Shutter Shades',
    description: 'Straight out of a South Beach nightclub.',
    slot: 'glasses',
    iconId: 'glasses',
    assetId: 'neon_shades',
    unique: true,
    sourceIds: ['shop_wardrobe'],
    costBrains: 35,
  },
  {
    id: 'cos_flamingo_float',
    type: 'cosmetic',
    displayName: 'Inflatable Flamingo',
    description: 'Poolside chic for amphibious ambushes.',
    slot: 'back',
    iconId: 'back',
    assetId: 'flamingo_float',
    unique: true,
    sourceIds: ['ach_beach_bum'],
    costBrains: 40,
  },
  {
    id: 'cos_boombox',
    type: 'cosmetic',
    displayName: 'Retro Boombox',
    description: 'Loops tropical basslines everywhere the horde marches.',
    slot: 'back',
    iconId: 'back',
    assetId: 'boombox',
    unique: true,
    sourceIds: ['secret_zombie_radio'],
    costBrains: 45,
  },
  {
    id: 'cos_selfie_stick',
    type: 'cosmetic',
    displayName: 'Bent Selfie Stick',
    description: 'Captured mid-chomp.',
    slot: 'hand',
    iconId: 'hand',
    assetId: 'selfie_stick',
    unique: true,
    sourceIds: ['ach_influencer'],
    costBrains: 25,
  },

  // --- Named Companions ---
  {
    id: 'comp_larry_lifeguard',
    type: 'companion',
    displayName: 'Larry the Lifeguard',
    description: 'His whistle pulls nearby stray zombies into the horde.',
    companionId: 'larry_lifeguard',
    iconId: 'companion',
    unique: true,
    sourceIds: ['discovery_larry'],
  },
  {
    id: 'comp_chef_brainsley',
    type: 'companion',
    displayName: 'Chef Brainsley',
    description: 'Clangs frying pans to distract nearby civilians.',
    companionId: 'chef_brainsley',
    iconId: 'companion',
    unique: true,
    sourceIds: ['discovery_chef'],
  },
  {
    id: 'comp_grandma_rot',
    type: 'companion',
    displayName: 'Grandma Rot',
    description: 'Swings a heavy handbag and refuses to get left behind.',
    companionId: 'grandma_rot',
    iconId: 'companion',
    unique: true,
    sourceIds: ['discovery_grandma'],
  },

  // --- Vehicles ---
  {
    id: 'veh_golf_cart',
    type: 'vehicle',
    displayName: 'Resort Golf Cart',
    description: 'Zippy arcade cruiser for skipping long stretches of asphalt.',
    vehicleKind: 'golf_cart',
    iconId: 'vehicle',
    unique: true,
    sourceIds: ['discovery_golf_cart', 'shop_garage'],
    costBrains: 35,
  },
  {
    id: 'veh_scooter',
    type: 'vehicle',
    displayName: 'Beach Scooter',
    description: 'Quick solo street weaving.',
    vehicleKind: 'scooter',
    iconId: 'vehicle',
    unique: true,
    sourceIds: ['shop_garage'],
    costBrains: 55,
  },
  {
    id: 'veh_ice_cream_truck',
    type: 'vehicle',
    displayName: 'Ice Cream Truck',
    description: 'Jingle draws curious bystanders out onto the sidewalk.',
    vehicleKind: 'ice_cream_truck',
    iconId: 'vehicle',
    unique: true,
    sourceIds: ['shop_garage'],
    costBrains: 90,
  },
  {
    id: 'veh_parade_float',
    type: 'vehicle',
    displayName: 'Zombie Parade Float',
    description: 'Heavy tropical float that keeps your horde rolling with you.',
    vehicleKind: 'parade_float',
    iconId: 'vehicle',
    unique: true,
    sourceIds: ['shop_garage'],
    costBrains: 140,
  },

  // --- Hideouts ---
  {
    id: 'hide_suburb_depot',
    type: 'hideout',
    displayName: 'Maple Heights Bus Depot',
    description: 'Cozy bus-stop safehouse with wardrobe and fast travel.',
    hideoutId: 'suburb_depot',
    iconId: 'hideout',
    unique: true,
    sourceIds: ['nest_start_claim'],
  },
  {
    id: 'hide_beach_hotel',
    type: 'hideout',
    displayName: 'Oceanfront Suite',
    description: 'Beachfront safehouse unlocked by taking Hotel Security.',
    hideoutId: 'beach_hotel',
    iconId: 'hideout',
    unique: true,
    sourceIds: ['stronghold_hotel_security'],
  },
  {
    id: 'hide_mall_safehouse',
    type: 'hideout',
    displayName: 'Galleria Food Court',
    description: 'Mall hideout with full trophy shelf and garage access.',
    hideoutId: 'mall_safehouse',
    iconId: 'hideout',
    unique: true,
    sourceIds: ['stronghold_mall_security'],
  },
  {
    id: 'hide_marina_boathouse',
    type: 'hideout',
    displayName: 'Marina Boathouse',
    description: 'Bayside hideout for northern coastal raids.',
    hideoutId: 'marina_boathouse',
    iconId: 'hideout',
    unique: true,
    sourceIds: ['stronghold_marina_crews'],
  },

  // --- Trophies / Experiences ---
  {
    id: 'trophy_mall_cart',
    type: 'trophy',
    displayName: 'Golden Shopping Cart',
    description: 'Commemorating a thorough inspection of Galleria District.',
    iconId: 'trophy',
    unique: true,
    sourceIds: ['ach_mall_walker'],
    hiddenUntilUnlocked: true,
  },
  {
    id: 'trophy_horde_banner',
    type: 'trophy',
    displayName: 'Zombie Crossing Banner',
    description: 'Lead a mighty horde across the city.',
    iconId: 'trophy',
    unique: true,
    sourceIds: ['ach_zombie_crossing'],
    hiddenUntilUnlocked: true,
  },
  {
    id: 'exp_disco_emote',
    type: 'experience',
    displayName: 'Disco Dance Pose',
    description: 'Uninvited guests always own the dance floor.',
    iconId: 'trophy',
    unique: true,
    sourceIds: ['ach_uninvited_guest'],
    hiddenUntilUnlocked: true,
  },
];

export const REWARD_BY_ID: Readonly<Record<string, RewardDefinition>> = Object.fromEntries(
  REWARDS.map(r => [r.id, r]),
);

export const COMPANIONS: readonly CompanionDef[] = [
  {
    id: 'larry_lifeguard',
    name: 'Larry the Lifeguard',
    title: 'Boardwalk Rescue Legend',
    districtId: 'sunny_boardwalk',
    unlockPos: { x: -290, z: 130 },
    description: 'Found near Sunny Boardwalk. His whistle pulls nearby stray zombies into the horde.',
    perkLabel: 'Whistle (recruits up to 3 nearby strays)',
    rewardId: 'comp_larry_lifeguard',
  },
  {
    id: 'chef_brainsley',
    name: 'Chef Brainsley',
    title: 'Sous-Chef of Undead Cuisine',
    districtId: 'shopping',
    unlockPos: { x: 110, z: 108 },
    description: 'Found near Galleria District cafes. Clangs pans to distract nearby civilians.',
    perkLabel: 'Pan Clang (freezes nearby civilians)',
    rewardId: 'comp_chef_brainsley',
  },
  {
    id: 'grandma_rot',
    name: 'Grandma Rot',
    title: 'Neighborhood Menace',
    districtId: 'suburbs',
    unlockPos: { x: -95, z: 65 },
    description: 'Found in Maple Heights. Swings a heavy handbag at anyone who gets close.',
    perkLabel: 'Handbag Wallop (staggers + hurts humans in reach)',
    rewardId: 'comp_grandma_rot',
  },
];

export const HIDEOUTS: readonly HideoutDef[] = [
  {
    id: 'suburb_depot',
    name: 'Maple Heights Bus Depot',
    districtId: 'suburbs',
    strongholdId: null,
    pos: { x: -124, z: 125 },
    description: 'Your first roadside hangout beside the wrecked bus.',
    rewardId: 'hide_suburb_depot',
  },
  {
    id: 'mall_safehouse',
    name: 'Galleria Food Court',
    districtId: 'shopping',
    strongholdId: 'mall_security',
    pos: { x: 112, z: 96 },
    description: 'Captured shopping-center hub with fast travel.',
    rewardId: 'hide_mall_safehouse',
  },
  {
    id: 'beach_hotel',
    name: 'Oceanfront Suite',
    districtId: 'oceanfront_hotels',
    strongholdId: 'hotel_security',
    pos: { x: 300, z: 112 },
    description: 'Luxury beachfront hideout.',
    rewardId: 'hide_beach_hotel',
  },
  {
    id: 'marina_boathouse',
    name: 'Marina Boathouse',
    districtId: 'luxury_marina',
    strongholdId: 'marina_crews',
    pos: { x: 300, z: -410 },
    description: 'Northern bay safehouse.',
    rewardId: 'hide_marina_boathouse',
  },
];

export const SECRETS: readonly SecretDef[] = [
  {
    id: 'secret_zombie_radio',
    title: 'Pirate Zombie Radio (99.9 FM)',
    districtId: 'neon_nights',
    pos: { x: 108, z: -245 },
    radius: 5.5,
    brainsReward: 30,
    rewardId: 'cos_boombox',
    description: 'A rooftop-relayed boombox broadcasting undead smooth jazz.',
  },
  {
    id: 'secret_sewer_shortcut',
    title: 'Boardwalk Storm Drain Shortcut',
    districtId: 'sunny_boardwalk',
    pos: { x: -245, z: 105 },
    radius: 5.5,
    brainsReward: 20,
    rewardId: null,
    description: 'An old maintenance tunnel under the boardwalk. Press V at either drain to crawl through.',
    shortcutTo: { x: -112, z: 60 },
  },
  {
    id: 'secret_golf_cart_stash',
    title: 'Abandoned Resort Golf Cart',
    districtId: 'suburbs',
    pos: { x: -155, z: 95 },
    radius: 5.5,
    brainsReward: 15,
    rewardId: 'veh_golf_cart',
    description: 'Keys still in the ignition!',
  },
];

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    id: 'ach_tourist_trap',
    title: 'Tourist Trap',
    description: 'Infect or convert 20 civilians across the city.',
    statKey: 'civiliansInfected',
    threshold: 20,
    rewardId: 'cos_oversized_shades',
    brainsBonus: 25,
  },
  {
    id: 'ach_road_rage',
    title: 'Road Rage',
    description: 'Trigger 5 traffic incidents or car stalls.',
    statKey: 'trafficIncidents',
    threshold: 5,
    rewardId: 'cos_traffic_cone',
    brainsBonus: 20,
  },
  {
    id: 'ach_beach_bum',
    title: 'Beach Bum',
    description: 'Recruit 25 zombies into your horde.',
    statKey: 'totalRecruited',
    threshold: 25,
    rewardId: 'cos_flamingo_float',
    brainsBonus: 25,
  },
  {
    id: 'ach_mall_walker',
    title: 'Mall Walker',
    description: 'Break into 2 shops or structures.',
    statKey: 'structuresBroken',
    threshold: 2,
    rewardId: 'trophy_mall_cart',
    brainsBonus: 20,
  },
  {
    id: 'ach_uninvited_guest',
    title: 'Uninvited Guest',
    description: 'Disrupt 3 spontaneous city events.',
    statKey: 'eventsDisrupted',
    threshold: 3,
    rewardId: 'exp_disco_emote',
    brainsBonus: 30,
  },
  {
    id: 'ach_zombie_crossing',
    title: 'Zombie Crossing',
    description: 'Reach a horde of 30 followers.',
    statKey: 'maxHordeSize',
    threshold: 30,
    rewardId: 'trophy_horde_banner',
    brainsBonus: 35,
  },
  {
    id: 'ach_fine_dining',
    title: 'Fine Dining',
    description: 'Trigger 3 environmental interactables.',
    statKey: 'interactablesUsed',
    threshold: 3,
    rewardId: 'cos_chef_hat',
    brainsBonus: 20,
  },
  {
    id: 'ach_influencer',
    title: 'Apocalypse Influencer',
    description: 'Interrupt 10 tourist/civilian crowds.',
    statKey: 'crowdsInterrupted',
    threshold: 10,
    rewardId: 'cos_selfie_stick',
    brainsBonus: 25,
  },
];

export const COSMETIC_SLOTS: readonly CosmeticSlot[] = ['hat', 'glasses', 'back', 'hand'];

export function vehicleUnlockOrder(): readonly PlayerVehicleKind[] {
  return ['golf_cart', 'scooter', 'ice_cream_truck', 'parade_float'];
}

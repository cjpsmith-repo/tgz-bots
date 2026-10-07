import raw from '../../data/game-data.json';

export type Resource = 'clay' | 'wood' | 'ivory' | 'diamonds';
export const RESOURCES: Resource[] = ['clay', 'wood', 'ivory', 'diamonds'];

export type CraftsmanType =
  | 'woodCarver'
  | 'potter'
  | 'ivoryCarver'
  | 'diamondCutter'
  | 'sculptor'
  | 'vesselMaker'
  | 'throneMaker';

export const CRAFTSMAN_TYPES: CraftsmanType[] = [
  'potter',
  'woodCarver',
  'ivoryCarver',
  'diamondCutter',
  'vesselMaker',
  'sculptor',
  'throneMaker',
];

export type GodId =
  | 'shadipinyi'
  | 'elegua'
  | 'dziva'
  | 'eshu'
  | 'gu'
  | 'obatala'
  | 'atete'
  | 'tsuiGoab'
  | 'anansi'
  | 'qamata'
  | 'engai'
  | 'xango';

export type SpecialistId = 'rainCeremony' | 'shaman' | 'builder' | 'herd' | 'nomads';
export const SPECIALISTS: SpecialistId[] = ['rainCeremony', 'shaman', 'builder', 'herd', 'nomads'];

export interface CraftsmanDef {
  kind: 'primary' | 'secondary';
  resource: Resource;
  needs?: CraftsmanType;
  cost: number;
  vp: number;
  footprint: [number, number];
  vr: [number, number];
}

export interface GodDef {
  vr: number;
  phase: string;
  effect: string;
}

export interface SpecialistDef {
  vr: number;
  useCost: number;
  effect: string;
}

export const DATA = raw as unknown as {
  startingVR: number;
  maxVR: number;
  startingCattle: number;
  monumentVPByLevel: number[];
  maxMonumentLevel: number;
  transportRange: number;
  hubCost: number;
  tiles: Record<string, { start?: boolean; grid: string[] }>;
  mapLayouts: Record<string, string[]>;
  supply: { craftsmenPerType: number; resourceTiles: Record<Resource, number>; waterTiles: number };
  craftsmen: Record<CraftsmanType, CraftsmanDef>;
  specialists: Record<SpecialistId, SpecialistDef>;
  godsInPlay: number;
  gods: Record<GodId, GodDef>;
};

export const ALL_GODS = Object.keys(DATA.gods) as GodId[];
export const BEGINNER_GODS: GodId[] = ['xango', 'tsuiGoab', 'elegua', 'gu', 'engai', 'obatala'];

/** The secondary craftsman type fed by each primary, if any. */
export function secondaryOf(primary: CraftsmanType): CraftsmanType | undefined {
  return CRAFTSMAN_TYPES.find((t) => DATA.craftsmen[t].needs === primary);
}

export const DISPLAY_NAMES: Record<string, string> = {
  woodCarver: 'Wood carver',
  potter: 'Potter',
  ivoryCarver: 'Ivory carver',
  diamondCutter: 'Diamond cutter',
  sculptor: 'Sculptor',
  vesselMaker: 'Vessel maker',
  throneMaker: 'Throne maker',
  rainCeremony: 'Rain Ceremony',
  shaman: 'Shaman',
  builder: 'Builder',
  herd: 'Herd',
  nomads: 'Nomads',
  shadipinyi: 'Shadipinyi',
  elegua: 'Elegua',
  dziva: 'Dziva',
  eshu: 'Eshu',
  gu: 'Gu',
  obatala: 'Obatala',
  atete: 'Atete',
  tsuiGoab: 'Tsui-Goab',
  anansi: 'Anansi',
  qamata: 'Qamata',
  engai: 'Engai',
  xango: 'Xango',
  clay: 'clay',
  wood: 'wood',
  ivory: 'ivory',
  diamonds: 'diamonds',
};

export function nameOf(id: string): string {
  return DISPLAY_NAMES[id] ?? id;
}

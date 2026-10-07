import type { CraftsmanType, GodId, Resource, SpecialistId } from './data';

export interface Monument {
  owner: number;
  level: number;
}

export interface Cell {
  water: boolean;
  resource?: Resource;
  /** Used markers on this resource this round. */
  used: number;
  start?: boolean;
  monument?: Monument;
  /** Id of the craftsman covering this cell. */
  craftsman?: number;
}

export interface Board {
  width: number;
  height: number;
  /** Row-major; null where there is no map tile. */
  cells: (Cell | null)[];
  /** Water area id per cell (orthogonally connected water), -1 for land/off-map. */
  waterArea: number[];
}

export interface Craftsman {
  id: number;
  type: CraftsmanType;
  owner: number;
  cells: number[];
}

export interface TechCard {
  /** 0 for the cheaper first card of a type, 1 for the second. */
  copy: 0 | 1;
  price: number;
  /** VR actually added when this card was taken (changes with Gu). */
  vrPaid: number;
}

export interface Player {
  id: number;
  name: string;
  color: string;
  isBot: boolean;
  cattle: number;
  /** Cattle sitting on this player's cards, collected in the revenue phase. */
  pending: number;
  vp: number;
  vr: number;
  /** Order the VR marker arrived on its square; lower = further down the stack. */
  vrSeq: number;
  techs: Partial<Record<CraftsmanType, TechCard>>;
  god?: GodId;
  specialists: SpecialistId[];
}

export interface Plaque {
  /** Player id, or -1 for Shadipinyi's plaque. */
  owner: number;
  cattle: number;
}

export interface BiddingState {
  plaques: Plaque[];
  /** Players in bidding order (plaque order, without Shadipinyi). */
  bidders: number[];
  /** Index into bidders of the player to act. */
  current: number;
  lastGift: number;
  /** Next plaque to receive a cattle. */
  pointer: number;
  passed: number[];
  /** New turn order slots, filled from the back as players pass. */
  slots: (number | null)[];
  /** Players who have made their first gift this round (for Elegua). */
  gifted: number[];
}

export interface TurnState {
  player: number;
  choseCard: boolean;
  /** Specialist chosen this turn; it must be used before the turn ends. */
  newSpecialist?: SpecialistId;
  usedSpecialists: SpecialistId[];
  mainAction?: 'monument' | 'craftsmen' | 'raise';
  nomadsActive: boolean;
  builderActive: boolean;
  /** Primary types whose first craftsman on the map this player placed this turn. */
  firstPrimaries: CraftsmanType[];
  dzivaUsed: boolean;
}

export interface GameOptions {
  beginner: boolean;
}

export type Phase = 'setup' | 'bidding' | 'actions' | 'gameOver';

export interface GameState {
  rng: number;
  options: GameOptions;
  board: Board;
  players: Player[];
  godsInPlay: GodId[];
  godOwner: Partial<Record<GodId, number>>;
  specialistsInPlay: SpecialistId[];
  specialistOwner: Partial<Record<SpecialistId, number>>;
  /** Owners of the 1st and 2nd tech card of each type, in the order taken. */
  techTaken: Record<CraftsmanType, number[]>;
  craftsmen: Craftsman[];
  nextCraftsmanId: number;
  supply: { resources: Record<Resource, number>; water: number };
  round: number;
  phase: Phase;
  /** Setup: players in the order they place their first monument. */
  setupOrder: number[];
  setupIndex: number;
  bidding?: BiddingState;
  turnOrder: number[];
  turnIndex: number;
  turn?: TurnState;
  vrSeqCounter: number;
  winner?: number;
  log: string[];
}

export interface GoodPurchase {
  /** Cell of the monument being raised. */
  monument: number;
  craftsman: number;
  /** Resource cell consumed by the craftsman. */
  resource: number;
  /** For secondary craftsmen: the primary craftsman supplying the primary good. */
  primary?: { craftsman: number; resource: number };
}

export type Action =
  | { type: 'placeStart'; cell: number }
  | { type: 'bid'; amount: number }
  | { type: 'pass' }
  | { type: 'chooseGod'; god: GodId }
  | { type: 'chooseSpecialist'; specialist: SpecialistId }
  | { type: 'useShaman'; resource: Resource; cell: number }
  | { type: 'useRain'; cells: [number, number] }
  | { type: 'useHerd'; times: number }
  | { type: 'useNomads' }
  | { type: 'useBuilder' }
  | { type: 'buildMonument'; cells: number[] }
  | { type: 'placeCraftsman'; craftsman: CraftsmanType; cells: number[]; price?: number }
  | { type: 'setPrices'; prices: Partial<Record<CraftsmanType, number>> }
  | { type: 'raise'; goods: GoodPurchase[] }
  | { type: 'endTurn' };

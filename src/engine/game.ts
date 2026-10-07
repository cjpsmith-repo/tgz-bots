import {
  ALL_GODS,
  BEGINNER_GODS,
  CRAFTSMAN_TYPES,
  DATA,
  SPECIALISTS,
  nameOf,
  secondaryOf,
  type CraftsmanType,
  type GodId,
  type Resource,
  type SpecialistId,
} from './data';
import {
  buildMap,
  cellsInRange,
  computeWaterAreas,
  hubsNeeded,
  invalidateRanges,
  isEmptyLand,
  neighbors8,
  orthNeighbors,
  xy,
} from './board';
import { shuffle } from './rng';
import type { Action, Board, BiddingState, GameState, GoodPurchase, Player } from './types';

export const PLAYER_COLORS = ['#c0392b', '#f1c40f', '#1f1f1f', '#f4f1ea', '#2e7d32'];
export const PLAYER_COLOR_NAMES = ['Red', 'Yellow', 'Black', 'White', 'Green'];
/** Safety stop: if nobody has won by then, the best VP − VR margin wins. */
export const MAX_ROUNDS = 40;

export class IllegalAction extends Error {}

function fail(msg: string): never {
  throw new IllegalAction(msg);
}

export interface NewGameOptions {
  players: { name: string; isBot: boolean }[];
  seed: number;
  beginner?: boolean;
  /** Override the random map (tests). */
  board?: Board;
}

export function createGame(opts: NewGameOptions): GameState {
  const n = opts.players.length;
  if (n < 2 || n > 5) throw new Error('The game needs 2 to 5 players');
  let rng = opts.seed >>> 0 || 1;
  let board: Board;
  if (opts.board) board = opts.board;
  else ({ board, rng } = buildMap(n, rng));

  const beginner = !!opts.beginner;
  let gods: GodId[];
  if (beginner) gods = BEGINNER_GODS.slice();
  else {
    let shuffled: GodId[];
    [shuffled, rng] = shuffle(ALL_GODS, rng);
    gods = shuffled.slice(0, DATA.godsInPlay);
  }

  const players: Player[] = opts.players.map((p, i) => ({
    id: i,
    name: p.name,
    color: PLAYER_COLORS[i],
    isBot: p.isBot,
    cattle: DATA.startingCattle,
    pending: 0,
    vp: 0,
    vr: DATA.startingVR,
    vrSeq: 0,
    techs: {},
    specialists: [],
  }));

  // Random VR marker stack; the top marker places the first monument.
  let stack: number[];
  [stack, rng] = shuffle(players.map((p) => p.id), rng);
  stack.forEach((id, i) => (players[id].vrSeq = i + 1));

  const techTaken = Object.fromEntries(CRAFTSMAN_TYPES.map((t) => [t, []])) as unknown as Record<CraftsmanType, number[]>;

  const state: GameState = {
    rng,
    options: { beginner },
    board,
    players,
    godsInPlay: gods,
    godOwner: {},
    specialistsInPlay: beginner ? [] : SPECIALISTS.slice(),
    specialistOwner: {},
    techTaken,
    craftsmen: [],
    nextCraftsmanId: 1,
    supply: { resources: { ...DATA.supply.resourceTiles }, water: DATA.supply.waterTiles },
    round: 0,
    phase: 'setup',
    setupOrder: stack.slice().reverse(),
    setupIndex: 0,
    turnOrder: [],
    turnIndex: 0,
    vrSeqCounter: n,
    log: [],
  };
  log(state, `New game: ${players.map((p) => p.name).join(', ')}. Gods in play: ${gods.map(nameOf).join(', ')}.`);
  return state;
}

export function log(state: GameState, msg: string): void {
  state.log.push(msg);
}

export function currentActor(state: GameState): number | null {
  switch (state.phase) {
    case 'setup':
      return state.setupOrder[state.setupIndex];
    case 'bidding':
      return state.bidding!.bidders[state.bidding!.current];
    case 'actions':
      return state.turn!.player;
    default:
      return null;
  }
}

/** Transport range in effect: 6 during the turn of Eshu's worshipper, else 3. */
export function currentRange(state: GameState): number {
  const p = state.phase === 'actions' ? state.turn?.player : undefined;
  return p !== undefined && state.players[p].god === 'eshu' ? 6 : DATA.transportRange;
}

function setVR(state: GameState, p: Player, vr: number): void {
  if (vr > DATA.maxVR) fail(`That would take your VR above ${DATA.maxVR}`);
  if (vr !== p.vr) {
    p.vr = vr;
    p.vrSeq = ++state.vrSeqCounter;
  }
}

export function techVR(state: GameState, p: Player, type: CraftsmanType): number {
  if (p.god === 'gu') return 1;
  return DATA.craftsmen[type].vr[state.techTaken[type].length];
}

export function highestMonument(state: GameState, player: number): number {
  let best = 0;
  for (const c of state.board.cells) if (c?.monument?.owner === player) best = Math.max(best, c.monument.level);
  return best;
}

export function monumentsOf(state: GameState, player: number): number[] {
  const out: number[] = [];
  state.board.cells.forEach((c, i) => {
    if (c?.monument?.owner === player) out.push(i);
  });
  return out;
}

// ---------------------------------------------------------------- apply

export function applyAction(stateIn: GameState, action: Action, actor?: number): GameState {
  const expected = currentActor(stateIn);
  if (expected === null) fail('The game is over');
  if (actor !== undefined && actor !== expected) fail('It is not your turn');
  const state = structuredClone(stateIn);
  const p = state.players[expected];
  switch (state.phase) {
    case 'setup':
      if (action.type !== 'placeStart') fail('Place your first monument on a starting area');
      placeStart(state, p, action.cell);
      break;
    case 'bidding':
      if (action.type === 'bid') bid(state, p, action.amount);
      else if (action.type === 'pass') passBid(state, p);
      else fail('Bid or pass');
      break;
    case 'actions':
      turnAction(state, p, action);
      break;
  }
  return state;
}

export function isLegal(state: GameState, action: Action): boolean {
  try {
    applyAction(state, action);
    return true;
  } catch (e) {
    if (e instanceof IllegalAction) return false;
    throw e;
  }
}

// ---------------------------------------------------------------- setup

function placeStart(state: GameState, p: Player, cell: number): void {
  const c = state.board.cells[cell];
  if (!c?.start || c.monument) fail('Choose a free starting area');
  c.monument = { owner: p.id, level: 1 };
  p.vp += 1;
  invalidateRanges(state);
  log(state, `${p.name} places their first monument.`);
  state.setupIndex++;
  if (state.setupIndex >= state.setupOrder.length) startRound(state);
}

// ---------------------------------------------------------------- phase I: bidding

function startRound(state: GameState): void {
  state.round++;
  log(state, `— Round ${state.round} —`);
  const order = state.players
    .slice()
    .sort((a, b) => b.vr - a.vr || a.vrSeq - b.vrSeq)
    .map((p) => p.id);
  const plaques = order.map((owner) => ({ owner, cattle: 0 }));
  if (state.godOwner.shadipinyi !== undefined) plaques.unshift({ owner: -1, cattle: 0 });
  state.phase = 'bidding';
  state.bidding = {
    plaques,
    bidders: order,
    current: 0,
    lastGift: 0,
    pointer: 0,
    passed: [],
    slots: order.map(() => null),
    gifted: [],
  };
  settleBidding(state);
}

/** Cattle the player pays from their own stock for a gift of `amount`. */
export function giftCost(state: GameState, p: Player, amount: number): number {
  const b = state.bidding!;
  const free = p.god === 'elegua' && !b.gifted.includes(p.id) ? Math.min(3, amount) : 0;
  return amount - free;
}

export function minGift(state: GameState): number {
  return state.bidding!.lastGift + 1;
}

export function maxGift(state: GameState, p: Player): number {
  const free = p.god === 'elegua' && !state.bidding!.gifted.includes(p.id) ? 3 : 0;
  return p.cattle + free;
}

function bid(state: GameState, p: Player, amount: number): void {
  const b = state.bidding!;
  if (!Number.isInteger(amount) || amount < minGift(state)) fail(`Your gift must be at least ${minGift(state)}`);
  const cost = giftCost(state, p, amount);
  if (cost > p.cattle) fail('You do not have enough cattle');
  p.cattle -= cost;
  b.gifted.push(p.id);
  b.lastGift = amount;
  for (let i = 0; i < amount; i++) {
    b.plaques[b.pointer].cattle++;
    b.pointer = (b.pointer + 1) % b.plaques.length;
  }
  log(state, `${p.name} gives ${amount} cattle${cost < amount ? ` (${amount - cost} from Elegua)` : ''}.`);
  advanceBidder(state);
}

function passBid(state: GameState, p: Player, auto = false): void {
  const b = state.bidding!;
  b.passed.push(p.id);
  const slot = b.slots.lastIndexOf(null);
  b.slots[slot] = p.id;
  log(state, `${p.name} ${auto ? 'cannot outbid and passes' : 'passes'} (turn order ${slot + 1}).`);
  advanceBidder(state);
}

function activeBidders(b: BiddingState): number[] {
  return b.bidders.filter((id) => !b.passed.includes(id));
}

function advanceBidder(state: GameState): void {
  const b = state.bidding!;
  if (activeBidders(b).length > 1) {
    do b.current = (b.current + 1) % b.bidders.length;
    while (b.passed.includes(b.bidders[b.current]));
  }
  settleBidding(state);
}

/** Auto-pass players who cannot bid, and end the phase when one bidder remains. */
function settleBidding(state: GameState): void {
  const b = state.bidding!;
  for (;;) {
    const active = activeBidders(b);
    if (active.length <= 1) {
      if (active.length === 1) b.slots[b.slots.indexOf(null)] = active[0];
      endBidding(state);
      return;
    }
    const p = state.players[b.bidders[b.current]];
    if (maxGift(state, p) >= minGift(state)) return;
    b.passed.push(p.id);
    const slot = b.slots.lastIndexOf(null);
    b.slots[slot] = p.id;
    log(state, `${p.name} cannot outbid and passes (turn order ${slot + 1}).`);
    do b.current = (b.current + 1) % b.bidders.length;
    while (b.passed.includes(b.bidders[b.current]) && activeBidders(b).length > 0);
  }
}

function endBidding(state: GameState): void {
  const b = state.bidding!;
  for (const plaque of b.plaques) {
    const owner = plaque.owner === -1 ? state.godOwner.shadipinyi : plaque.owner;
    if (owner !== undefined) state.players[owner].cattle += plaque.cattle;
  }
  state.turnOrder = b.slots as number[];
  log(state, `Turn order: ${state.turnOrder.map((id) => state.players[id].name).join(', ')}.`);
  state.phase = 'actions';
  state.turnIndex = 0;
  startTurn(state);
}

// ---------------------------------------------------------------- phase II: actions

function startTurn(state: GameState): void {
  state.turn = {
    player: state.turnOrder[state.turnIndex],
    choseCard: false,
    usedSpecialists: [],
    nomadsActive: false,
    builderActive: false,
    firstPrimaries: [],
    dzivaUsed: false,
  };
}

function turnAction(state: GameState, p: Player, a: Action): void {
  const t = state.turn!;
  switch (a.type) {
    case 'chooseGod':
      return chooseGod(state, p, a.god);
    case 'chooseSpecialist':
      return chooseSpecialist(state, p, a.specialist);
    case 'useShaman':
    case 'useRain':
    case 'useHerd':
    case 'useNomads':
    case 'useBuilder':
      return useSpecialist(state, p, a);
    case 'buildMonument':
      if (t.mainAction) fail('You have already taken your main action');
      buildMonuments(state, p, a.cells);
      t.mainAction = 'monument';
      return;
    case 'placeCraftsman':
      if (t.mainAction && t.mainAction !== 'craftsmen') fail('You have already taken your main action');
      placeCraftsman(state, p, a.craftsman, a.cells, a.price);
      t.mainAction = 'craftsmen';
      return;
    case 'setPrices':
      return setPrices(state, p, a.prices);
    case 'raise':
      if (t.mainAction) fail('You have already taken your main action');
      raiseMonuments(state, p, a.goods);
      t.mainAction = 'raise';
      return;
    case 'endTurn':
      return endTurn(state, p);
    default:
      fail('That is not possible now');
  }
}

export function godVR(p: Player, god: GodId): number {
  if (god === 'gu') {
    const refund = Object.values(p.techs).reduce((s, tc) => s + (tc!.vrPaid - 1), 0);
    return p.vr - refund + DATA.gods.gu.vr;
  }
  return p.vr + DATA.gods[god].vr;
}

function chooseGod(state: GameState, p: Player, god: GodId): void {
  const t = state.turn!;
  if (t.choseCard) fail('You may choose only one god or specialist per turn');
  if (p.god) fail('You already adore a god');
  if (!state.godsInPlay.includes(god) || state.godOwner[god] !== undefined) fail('That god is not available');
  setVR(state, p, godVR(p, god));
  if (god === 'gu') for (const tc of Object.values(p.techs)) tc!.vrPaid = 1;
  p.god = god;
  state.godOwner[god] = p.id;
  t.choseCard = true;
  log(state, `${p.name} adores ${nameOf(god)} (VR ${p.vr}).`);
}

function chooseSpecialist(state: GameState, p: Player, s: SpecialistId): void {
  const t = state.turn!;
  if (t.choseCard) fail('You may choose only one god or specialist per turn');
  if (!state.specialistsInPlay.includes(s) || state.specialistOwner[s] !== undefined) fail('That specialist is not available');
  const def = DATA.specialists[s];
  if (p.cattle < def.useCost) fail(`You need ${def.useCost} cattle to use the ${nameOf(s)} this turn`);
  setVR(state, p, p.vr + def.vr);
  p.specialists.push(s);
  state.specialistOwner[s] = p.id;
  t.choseCard = true;
  t.newSpecialist = s;
  log(state, `${p.name} takes the ${nameOf(s)} (VR ${p.vr}).`);
}

function useSpecialist(state: GameState, p: Player, a: Action): void {
  const t = state.turn!;
  const s: SpecialistId =
    a.type === 'useShaman'
      ? 'shaman'
      : a.type === 'useRain'
        ? 'rainCeremony'
        : a.type === 'useHerd'
          ? 'herd'
          : a.type === 'useNomads'
            ? 'nomads'
            : 'builder';
  if (!p.specialists.includes(s)) fail(`You do not have the ${nameOf(s)}`);
  if (t.usedSpecialists.includes(s)) fail(`You have already used the ${nameOf(s)} this turn`);
  let cost = DATA.specialists[s].useCost;
  const b = state.board;

  switch (a.type) {
    case 'useShaman': {
      if (state.supply.resources[a.resource] <= 0) fail(`No ${a.resource} tiles are left`);
      if (!isEmptyLand(b.cells[a.cell])) fail('Resources go on empty land');
      if (p.cattle < cost) fail('Not enough cattle');
      b.cells[a.cell]!.resource = a.resource;
      state.supply.resources[a.resource]--;
      log(state, `${p.name}'s Shaman places ${a.resource}.`);
      break;
    }
    case 'useRain': {
      const [c1, c2] = a.cells;
      if (state.supply.water <= 0) fail('No water tiles are left');
      if (!isEmptyLand(b.cells[c1]) || !isEmptyLand(b.cells[c2]) || !orthNeighbors(b, c1).includes(c2))
        fail('Water goes on two adjacent empty land areas');
      if (p.cattle < cost) fail('Not enough cattle');
      b.cells[c1]!.water = true;
      b.cells[c2]!.water = true;
      state.supply.water--;
      computeWaterAreas(b);
      log(state, `${p.name}'s Rain Ceremony floods the plain.`);
      break;
    }
    case 'useHerd': {
      if (!Number.isInteger(a.times) || a.times < 1 || a.times > 3) fail('Use the Herd 1 to 3 times');
      cost = 2 * a.times;
      if (p.cattle < cost) fail('Not enough cattle');
      p.pending += a.times; // the extra cattle from the common stock
      log(state, `${p.name}'s Herd breeds ${a.times} cattle.`);
      break;
    }
    case 'useNomads':
      if (p.cattle < cost) fail('Not enough cattle');
      t.nomadsActive = true;
      log(state, `${p.name} hires the Nomads.`);
      break;
    case 'useBuilder':
      if (p.cattle < cost) fail('Not enough cattle');
      t.builderActive = true;
      log(state, `${p.name} hires the Builder.`);
      break;
  }
  p.cattle -= cost;
  p.pending += cost; // paid onto the player's own specialist card
  t.usedSpecialists.push(s);
  if (t.newSpecialist === s) t.newSpecialist = undefined;
  invalidateRanges(state);
}

export function monumentSpotError(state: GameState, cell: number, nomads: boolean): string | null {
  const b = state.board;
  if (!isEmptyLand(b.cells[cell])) return 'Monuments go on empty land';
  if (!nomads && neighbors8(b, cell).some((n) => b.cells[n]!.monument)) return 'Too close to another monument';
  return null;
}

function buildMonuments(state: GameState, p: Player, cells: number[]): void {
  const max = p.god === 'obatala' ? 2 : 1;
  if (cells.length < 1 || cells.length > max) fail(max === 2 ? 'Build one or two monuments' : 'Build one monument');
  for (const cell of cells) {
    const err = monumentSpotError(state, cell, state.turn!.nomadsActive);
    if (err) fail(err);
    state.board.cells[cell]!.monument = { owner: p.id, level: 1 };
    p.vp += 1;
    invalidateRanges(state);
  }
  log(state, `${p.name} builds ${cells.length === 2 ? 'two monuments' : 'a monument'}.`);
}

export function craftsmenOfType(state: GameState, type: CraftsmanType) {
  return state.craftsmen.filter((c) => c.type === type);
}

/** Valid footprint for a craftsman tile, or an error. */
function footprintError(state: GameState, type: CraftsmanType, cells: number[]): string | null {
  const b = state.board;
  const [w, h] = DATA.craftsmen[type].footprint;
  const size = w * h;
  if (cells.length !== size || new Set(cells).size !== size) return `This craftsman covers ${size} areas`;
  if (!cells.every((c) => isEmptyLand(b.cells[c]))) return 'Craftsmen go on empty land';
  const pts = cells.map((c) => xy(b, c));
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const spanX = Math.max(...xs) - Math.min(...xs) + 1;
  const spanY = Math.max(...ys) - Math.min(...ys) + 1;
  const ok = (spanX === w && spanY === h) || (spanX === h && spanY === w);
  return ok ? null : 'Wrong shape for this craftsman';
}

export function craftsmanError(
  state: GameState,
  p: Player,
  type: CraftsmanType,
  cells: number[],
  price?: number,
): string | null {
  const def = DATA.craftsmen[type];
  const existing = craftsmenOfType(state, type);
  if (existing.length >= DATA.supply.craftsmenPerType) return `All ${nameOf(type)} tiles are on the map`;
  if (!p.techs[type]) {
    if (state.techTaken[type].length >= 2) return `No ${nameOf(type)} technology is left`;
    if (p.vr + techVR(state, p, type) > DATA.maxVR) return `That technology would take your VR above ${DATA.maxVR}`;
    if (price === undefined || ![1, 2, 3].includes(price)) return 'Set a price of 1, 2 or 3 cattle';
  }
  if (p.cattle < def.cost) return `You need ${def.cost} cattle`;
  const fp = footprintError(state, type, cells);
  if (fp) return fp;

  const range = currentRange(state);
  const inRange = cellsInRange(state, cells, range);
  const claimed = new Set<number>();
  for (const other of existing) for (const c of cellsInRange(state, other.cells, range)) claimed.add(c);
  const free = [...inRange].some((c) => state.board.cells[c]!.resource === def.resource && !claimed.has(c));
  if (!free) return `Needs ${def.resource} in range that no other ${nameOf(type)} can reach`;

  if (def.kind === 'secondary') {
    const need = def.needs!;
    if (state.turn?.firstPrimaries.includes(need))
      return `You cannot build this in the same turn as the first ${nameOf(need)}`;
    const primaries = craftsmenOfType(state, need);
    if (!primaries.some((pc) => hubsNeeded(state, cells, pc.cells, range) < Infinity))
      return `Needs a ${nameOf(need)} in range (hubs allowed)`;
  }
  return null;
}

function placeCraftsman(state: GameState, p: Player, type: CraftsmanType, cells: number[], price?: number): void {
  const err = craftsmanError(state, p, type, cells, price);
  if (err) fail(err);
  const def = DATA.craftsmen[type];
  if (!p.techs[type]) {
    const vrAdd = techVR(state, p, type);
    const copy = state.techTaken[type].length as 0 | 1;
    setVR(state, p, p.vr + vrAdd);
    state.techTaken[type].push(p.id);
    p.techs[type] = { copy, price: price!, vrPaid: vrAdd };
    log(state, `${p.name} takes the ${nameOf(type)} technology at ${price} cattle (VR ${p.vr}).`);
  }
  const firstOfType = craftsmenOfType(state, type).length === 0;
  const toBuilder = state.turn!.builderActive ? Math.min(2, def.cost) : 0;
  p.cattle -= def.cost;
  p.pending += toBuilder;
  const id = state.nextCraftsmanId++;
  state.craftsmen.push({ id, type, owner: p.id, cells: cells.slice() });
  for (const c of cells) state.board.cells[c]!.craftsman = id;
  p.vp += def.vp;
  if (firstOfType && def.kind === 'primary') state.turn!.firstPrimaries.push(type);
  invalidateRanges(state);
  log(state, `${p.name} builds a ${nameOf(type)} (+${def.vp} VP).`);
}

function setPrices(state: GameState, p: Player, prices: Partial<Record<CraftsmanType, number>>): void {
  const t = state.turn!;
  const dziva = p.god === 'dziva' && !t.dzivaUsed;
  let lowered = false;
  for (const [type, price] of Object.entries(prices) as [CraftsmanType, number][]) {
    const tc = p.techs[type];
    if (!tc) fail(`You do not own the ${nameOf(type)} technology`);
    if (![1, 2, 3].includes(price)) fail('Prices are 1, 2 or 3 cattle');
    if (price < tc.price) lowered = true;
  }
  if (lowered && !dziva) fail('Only Dziva lets you lower prices');
  if (!dziva && t.mainAction !== 'craftsmen') fail('You can raise prices only after placing craftsmen');
  for (const [type, price] of Object.entries(prices) as [CraftsmanType, number][]) p.techs[type]!.price = price;
  if (dziva && (lowered || t.mainAction !== 'craftsmen')) t.dzivaUsed = true;
  log(state, `${p.name} sets prices: ${Object.entries(prices).map(([k, v]) => `${nameOf(k)} ${v}`).join(', ')}.`);
}

// ---------------------------------------------------------------- raising monuments

export interface RaiseQuote {
  total: number;
  /** Cattle paid to each player's cards (by player id). */
  toPlayers: Map<number, number>;
  toStock: number;
  vpGain: number;
  hubs: number;
}

/** True if the primary good of this type may still be used in rituals. */
export function primaryGoodUsable(state: GameState, type: CraftsmanType): boolean {
  const sec = secondaryOf(type);
  return !sec || craftsmenOfType(state, sec).length === 0;
}

export function resourceCapacity(p: Player): number {
  return p.god === 'atete' ? 2 : 1;
}

/** Validate a raise and compute what it costs. Throws IllegalAction. */
export function quoteRaise(state: GameState, p: Player, goods: GoodPurchase[]): RaiseQuote {
  if (!goods.length) fail('Choose ritual goods to buy');
  const b = state.board;
  const range = currentRange(state);
  const byMonument = new Map<number, GoodPurchase[]>();
  for (const g of goods) {
    if (!byMonument.has(g.monument)) byMonument.set(g.monument, []);
    byMonument.get(g.monument)!.push(g);
  }
  const quote: RaiseQuote = { total: 0, toPlayers: new Map(), toStock: 0, vpGain: 0, hubs: 0 };
  const hubPayee = state.godOwner.qamata;
  const pay = (owner: number | undefined, amt: number) => {
    quote.total += amt;
    if (owner === undefined) quote.toStock += amt;
    else quote.toPlayers.set(owner, (quote.toPlayers.get(owner) ?? 0) + amt);
  };
  const usage = new Map<number, number>();
  const cap = resourceCapacity(p);
  const useResource = (craftsmanId: number, cell: number) => {
    const cm = state.craftsmen.find((c) => c.id === craftsmanId)!;
    const res = b.cells[cell]?.resource;
    if (res !== DATA.craftsmen[cm.type].resource) fail(`The ${nameOf(cm.type)} needs ${DATA.craftsmen[cm.type].resource}`);
    if (!cellsInRange(state, cm.cells, range).has(cell)) fail(`That ${res} is out of the ${nameOf(cm.type)}'s range`);
    const n = (usage.get(cell) ?? 0) + 1;
    if (b.cells[cell]!.used + n > cap) fail(`That ${res} has already been used`);
    usage.set(cell, n);
  };
  const price = (owner: number, type: CraftsmanType) =>
    p.god === 'anansi' ? 1 : state.players[owner].techs[type]!.price;

  for (const [mcell, list] of byMonument) {
    const m = b.cells[mcell]?.monument;
    if (!m || m.owner !== p.id) fail('You can only raise your own monuments');
    if (m.level >= DATA.maxMonumentLevel) fail('That monument is already at the top level');
    if (list.length !== m.level) fail(`A level ${m.level} monument needs ${m.level} ritual good${m.level > 1 ? 's' : ''}`);
    const types = new Set<CraftsmanType>();
    for (const g of list) {
      const cm = state.craftsmen.find((c) => c.id === g.craftsman);
      if (!cm) fail('Unknown craftsman');
      const def = DATA.craftsmen[cm.type];
      if (types.has(cm.type) && p.god !== 'tsuiGoab') fail('Each ritual good for a monument must be different');
      types.add(cm.type);
      const hubs = hubsNeeded(state, [mcell], cm.cells, range);
      if (hubs === Infinity) fail(`The ${nameOf(cm.type)} is out of range`);
      quote.hubs += hubs;
      pay(hubPayee, hubs * DATA.hubCost);
      pay(cm.owner, price(cm.owner, cm.type));
      useResource(cm.id, g.resource);
      if (def.kind === 'primary') {
        if (!primaryGoodUsable(state, cm.type)) fail(`${nameOf(cm.type)} goods are no longer accepted in rituals`);
      } else {
        if (!g.primary) fail(`The ${nameOf(cm.type)} needs a ${nameOf(def.needs!)} good`);
        const pc = state.craftsmen.find((c) => c.id === g.primary!.craftsman);
        if (!pc || pc.type !== def.needs) fail(`The ${nameOf(cm.type)} needs a ${nameOf(def.needs!)}`);
        const h2 = hubsNeeded(state, cm.cells, pc.cells, range);
        if (h2 === Infinity) fail(`The ${nameOf(pc.type)} is out of the ${nameOf(cm.type)}'s range`);
        quote.hubs += h2;
        pay(hubPayee, h2 * DATA.hubCost);
        pay(pc.owner, price(pc.owner, pc.type));
        useResource(pc.id, g.primary.resource);
      }
    }
    quote.vpGain += DATA.monumentVPByLevel[m.level + 1] - DATA.monumentVPByLevel[m.level];
  }
  if (quote.total > p.cattle) fail(`This costs ${quote.total} cattle; you have ${p.cattle}`);
  return quote;
}

function raiseMonuments(state: GameState, p: Player, goods: GoodPurchase[]): void {
  const q = quoteRaise(state, p, goods);
  p.cattle -= q.total;
  for (const [owner, amt] of q.toPlayers) state.players[owner].pending += amt;
  for (const g of goods) {
    state.board.cells[g.resource]!.used++;
    if (g.primary) state.board.cells[g.primary.resource]!.used++;
  }
  const monuments = [...new Set(goods.map((g) => g.monument))];
  for (const m of monuments) state.board.cells[m]!.monument!.level++;
  p.vp += q.vpGain;
  invalidateRanges(state);
  log(
    state,
    `${p.name} raises ${monuments.length} monument${monuments.length > 1 ? 's' : ''} for ${q.total} cattle (+${q.vpGain} VP).`,
  );
}

// ---------------------------------------------------------------- end of turn / round

function endTurn(state: GameState, p: Player): void {
  const t = state.turn!;
  if (t.newSpecialist) fail(`You must use the ${nameOf(t.newSpecialist)} you chose this turn`);
  log(state, `${p.name} ends their turn.`);
  state.turnIndex++;
  if (state.turnIndex < state.turnOrder.length) {
    startTurn(state);
    return;
  }
  state.turn = undefined;
  revenue(state);
  if (checkWinner(state)) return;
  startRound(state);
}

function revenue(state: GameState): void {
  for (const p of state.players) {
    const income = highestMonument(state, p.id) + (p.god === 'engai' ? 2 : 0);
    p.cattle += p.pending + income;
    if (p.pending || income) log(state, `${p.name} collects ${p.pending} from cards and ${income} income.`);
    p.pending = 0;
  }
}

function checkWinner(state: GameState): boolean {
  let candidates = state.players.filter((p) => p.vp >= p.vr);
  if (!candidates.length && state.round >= MAX_ROUNDS) candidates = state.players.slice();
  if (candidates.length) {
    const xango = candidates.find((p) => p.god === 'xango');
    const order = (id: number) => state.turnOrder.indexOf(id);
    const winner =
      xango ??
      candidates.slice().sort((a, b) => b.vp - b.vr - (a.vp - a.vr) || b.vp - a.vp || order(a.id) - order(b.id))[0];
    state.winner = winner.id;
    state.phase = 'gameOver';
    log(state, `${winner.name} wins with ${winner.vp} VP (needed ${winner.vr})!`);
    return true;
  }
  for (const c of state.board.cells) if (c) c.used = 0;
  return false;
}

/** All resources of a type, used by bots and UI hints. */
export function resourceCells(state: GameState, res: Resource): number[] {
  const out: number[] = [];
  state.board.cells.forEach((c, i) => {
    if (c?.resource === res) out.push(i);
  });
  return out;
}

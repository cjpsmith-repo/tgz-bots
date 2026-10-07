import { CRAFTSMAN_TYPES, DATA, type CraftsmanType, type GodId } from './data';
import { cellsInRange, hubsNeeded, isEmptyLand, neighbors8, xy, idx, inBoard } from './board';
import {
  applyAction,
  craftsmanError,
  craftsmenOfType,
  currentActor,
  currentRange,
  giftCost,
  godVR,
  IllegalAction,
  maxGift,
  minGift,
  monumentSpotError,
  monumentsOf,
} from './game';
import { planRaise } from './raise';
import type { Action, GameState, Player } from './types';

/** Rough worth of each god to the bot, before VR cost. */
const GOD_WORTH: Record<GodId, number> = {
  engai: 9,
  obatala: 9,
  tsuiGoab: 6,
  atete: 6,
  anansi: 7,
  eshu: 6,
  elegua: 6,
  shadipinyi: 6,
  gu: 5,
  qamata: 3,
  dziva: 2,
  xango: 2.5,
};

export function chooseBotAction(state: GameState): Action {
  const id = currentActor(state);
  if (id === null) throw new Error('No one to act');
  const p = state.players[id];
  switch (state.phase) {
    case 'setup':
      return chooseStart(state);
    case 'bidding':
      return chooseBid(state, p);
    default:
      return planTurn(state, p)[0];
  }
}

// ---------------------------------------------------------------- setup

function areaValue(state: GameState, cells: number[], range: number): number {
  const seen = new Set<string>();
  let count = 0;
  for (const c of cellsInRange(state, cells, range)) {
    const r = state.board.cells[c]!.resource;
    if (r) {
      seen.add(r);
      count++;
    }
  }
  return seen.size * 2 + count * 0.5;
}

function chooseStart(state: GameState): Action {
  let best = -1;
  let bestScore = -Infinity;
  state.board.cells.forEach((c, i) => {
    if (!c?.start || c.monument) return;
    const s = areaValue(state, [i], 4) + (neighbors8(state.board, i).some((n) => state.board.cells[n]!.monument) ? -3 : 0);
    if (s > bestScore) {
      bestScore = s;
      best = i;
    }
  });
  return { type: 'placeStart', cell: best };
}

// ---------------------------------------------------------------- bidding

function chooseBid(state: GameState, p: Player): Action {
  const need = minGift(state);
  if (need > maxGift(state, p)) return { type: 'pass' };
  const closeToWin = p.vr - p.vp <= 10;
  const fraction = closeToWin ? 0.5 : 0.25;
  const willing = Math.max(state.round === 1 ? 1 : 0, Math.floor(p.cattle * fraction));
  return giftCost(state, p, need) <= willing ? { type: 'bid', amount: need } : { type: 'pass' };
}

// ---------------------------------------------------------------- evaluation

/** Heuristic value of a position for player `id`. */
export function evaluate(state: GameState, id: number): number {
  const p = state.players[id];
  if (state.phase === 'gameOver') return state.winner === id ? 1000 : -1000;
  let v = p.vp - p.vr;
  if (p.vp >= p.vr) v += 100;
  v += 0.4 * p.cattle + 0.35 * p.pending;
  const range = DATA.transportRange;
  // Craftsmen are investments: future income plus cheap goods for our own rituals.
  for (const c of state.craftsmen) {
    if (c.owner !== id) continue;
    let customers = 0;
    state.board.cells.forEach((cl, i) => {
      if (cl?.monument && cellsInRange(state, [i], range * 2, true).has(c.cells[0])) customers++;
    });
    const price = p.techs[c.type]!.price;
    v += 1.5 + Math.min(customers, 6) * 0.35 * price;
  }
  // Monuments with craftsmen nearby are worth more than their current VP.
  for (const m of monumentsOf(state, id)) {
    const level = state.board.cells[m]!.monument!.level;
    if (level >= DATA.maxMonumentLevel) continue;
    const types = new Set<CraftsmanType>();
    for (const c of state.craftsmen) if (hubsNeeded(state, [m], c.cells, range) <= 1) types.add(c.type);
    const nextGain = DATA.monumentVPByLevel[level + 1] - DATA.monumentVPByLevel[level];
    if (types.size >= level) v += 0.25 * nextGain;
    v += 0.3 * Math.min(types.size, 4);
  }
  return v;
}

// ---------------------------------------------------------------- turn planning

function tryApply(state: GameState, actions: Action[]): GameState | null {
  let s = state;
  try {
    for (const a of actions) s = applyAction(s, a);
    return s;
  } catch (e) {
    if (e instanceof IllegalAction) return null;
    throw e;
  }
}

function monumentCandidates(state: GameState, p: Player, max: number): number[][] {
  const nomads = state.turn!.nomadsActive;
  const scored: [number, number][] = [];
  state.board.cells.forEach((c, i) => {
    if (!c || monumentSpotError(state, i, nomads)) return;
    let s = areaValue(state, [i], 3);
    for (const cm of state.craftsmen) if (cellsInRange(state, [i], 3, true).has(cm.cells[0])) s += 1.5;
    scored.push([s, i]);
  });
  scored.sort((a, b) => b[0] - a[0]);
  const top = scored.slice(0, max).map(([, i]) => i);
  if (p.god !== 'obatala') return top.map((i) => [i]);
  const out: number[][] = [];
  for (const a of top) {
    const second = scored.find(([, j]) => j !== a && !neighbors8(state.board, a).includes(j));
    out.push(second ? [a, second[1]] : [a]);
  }
  return out;
}

/** All footprints (cell lists) of a craftsman type on empty land. */
function footprints(state: GameState, type: CraftsmanType): number[][] {
  const b = state.board;
  const [w, h] = DATA.craftsmen[type].footprint;
  const shapes = w === h ? [[w, h]] : [[w, h], [h, w]];
  const out: number[][] = [];
  for (let y = 0; y < b.height; y++) {
    for (let x = 0; x < b.width; x++) {
      for (const [sw, sh] of shapes) {
        const cells: number[] = [];
        let ok = true;
        for (let dy = 0; dy < sh && ok; dy++) {
          for (let dx = 0; dx < sw && ok; dx++) {
            if (!inBoard(b, x + dx, y + dy) || !isEmptyLand(b.cells[idx(b, x + dx, y + dy)])) ok = false;
            else cells.push(idx(b, x + dx, y + dy));
          }
        }
        if (ok) out.push(cells);
      }
    }
  }
  return out;
}

function craftsmanCandidates(state: GameState, p: Player): Action[] {
  const out: Action[] = [];
  const range = currentRange(state);
  for (const type of CRAFTSMAN_TYPES) {
    if (!p.techs[type] && state.techTaken[type].length >= 2) continue;
    if (p.cattle < DATA.craftsmen[type].cost) continue;
    if (craftsmenOfType(state, type).length >= DATA.supply.craftsmenPerType) continue;
    const price = type === 'diamondCutter' ? 3 : 2;
    let best: number[] | null = null;
    let bestScore = -Infinity;
    for (const cells of footprints(state, type)) {
      if (craftsmanError(state, p, type, cells, price)) continue;
      const near = cellsInRange(state, cells, range);
      let s = 0;
      for (const c of near) {
        const cl = state.board.cells[c]!;
        if (cl.resource === DATA.craftsmen[type].resource) s += 1;
      }
      for (const m of monumentsOf(state, p.id)) if (hubsNeeded(state, [m], cells, range) <= 1) s += 1.5;
      state.board.cells.forEach((cl, i) => {
        if (cl?.monument && cl.monument.owner !== p.id && near.has(i)) s += 0.5;
      });
      // Leave room: avoid sitting right next to our own monuments' building spots.
      const [cx, cy] = xy(state.board, cells[0]);
      s -= 0.01 * (cx + cy);
      if (s > bestScore) {
        bestScore = s;
        best = cells;
      }
    }
    if (best) out.push({ type: 'placeCraftsman', craftsman: type, cells: best, ...(p.techs[type] ? {} : { price }) });
  }
  return out;
}

function raiseCandidates(state: GameState, p: Player): Action[] {
  const mons = monumentsOf(state, p.id)
    .filter((m) => state.board.cells[m]!.monument!.level < DATA.maxMonumentLevel)
    .sort((a, b) => state.board.cells[b]!.monument!.level - state.board.cells[a]!.monument!.level);
  const out: Action[] = [];
  const seen = new Set<string>();
  const orders = [mons, mons.slice().reverse(), ...mons.map((m) => [m])];
  for (const order of orders) {
    const plan = planRaise(state, p, order);
    if (!plan.goods.length) continue;
    const key = plan.monuments.slice().sort().join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type: 'raise', goods: plan.goods });
  }
  return out;
}

function godPrefixes(state: GameState, p: Player): Action[][] {
  const out: Action[][] = [[]];
  if (p.god || state.turn!.choseCard) return out;
  for (const god of state.godsInPlay) {
    if (state.godOwner[god] !== undefined) continue;
    const newVR = godVR(p, god);
    if (newVR > DATA.maxVR) continue;
    const worth = GOD_WORTH[god] - (newVR - p.vr);
    // Gods pay off over many rounds; late in the game only Xango's VR cut matters.
    if (worth > 1 && (state.round <= 4 || god === 'xango')) out.push([{ type: 'chooseGod', god }]);
  }
  return out;
}

function godBonus(state: GameState, prefix: Action[]): number {
  const a = prefix[0];
  if (!a || a.type !== 'chooseGod') return 0;
  return GOD_WORTH[a.god] * Math.max(0.3, 1 - (state.round - 1) * 0.15);
}

/** Plan the rest of the current turn as a list of actions ending in endTurn. */
export function planTurn(state: GameState, p: Player): Action[] {
  const t = state.turn!;
  const end: Action = { type: 'endTurn' };
  if (t.mainAction) return [end];

  let best: Action[] = [end];
  let bestScore = evaluate(state, p.id);
  for (const prefix of godPrefixes(state, p)) {
    const base = prefix.length ? tryApply(state, prefix) : state;
    if (!base) continue;
    const bp = base.players[p.id];
    const bonus = godBonus(state, prefix);
    const mains: Action[] = [
      ...raiseCandidates(base, bp),
      ...monumentCandidates(base, bp, 4).map((cells) => ({ type: 'buildMonument', cells }) as Action),
      ...craftsmanCandidates(base, bp),
    ];
    const options: Action[][] = [prefix, ...mains.map((m) => [...prefix, m])];
    for (const opt of options) {
      const s = opt.length ? tryApply(state, opt) : state;
      if (!s) continue;
      const score = evaluate(s, p.id) + bonus;
      if (score > bestScore + 1e-9) {
        bestScore = score;
        best = [...opt, end];
      }
    }
  }
  return best;
}


import { DATA, type CraftsmanType } from './data';
import { cellsInRange, hubsNeeded } from './board';
import { currentRange, primaryGoodUsable, resourceCapacity } from './game';
import type { Craftsman, GameState, GoodPurchase, Player } from './types';

interface Option {
  type: CraftsmanType;
  craftsman: Craftsman;
  primary?: Craftsman;
  /** Cattle leaving the player's hands now. */
  cash: number;
  /** Cattle that will not come back (paid to others or the stock). */
  net: number;
}

export interface RaisePlan {
  goods: GoodPurchase[];
  cash: number;
  net: number;
  vpGain: number;
  monuments: number[];
}

/**
 * Greedy sourcing: for each monument (in the given order), buy the cheapest
 * distinct ritual goods available, reserving resources as it goes.
 * Monuments that cannot be fully supplied are skipped.
 */
export function planRaise(state: GameState, p: Player, monuments: number[], budget = p.cattle): RaisePlan {
  const range = currentRange(state);
  const usage = new Map<number, number>();
  const cap = resourceCapacity(p);
  const plan: RaisePlan = { goods: [], cash: 0, net: 0, vpGain: 0, monuments: [] };
  const hubPayee = state.godOwner.qamata;

  const price = (c: Craftsman) => (p.god === 'anansi' ? 1 : state.players[c.owner].techs[c.type]!.price);
  const netOf = (owner: number | undefined, amt: number) => (owner === p.id ? 0 : amt);

  const freeResource = (c: Craftsman, extra?: Map<number, number>): number | undefined => {
    const res = DATA.craftsmen[c.type].resource;
    for (const cell of cellsInRange(state, c.cells, range)) {
      const cl = state.board.cells[cell]!;
      if (cl.resource !== res) continue;
      const used = cl.used + (usage.get(cell) ?? 0) + (extra?.get(cell) ?? 0);
      if (used < cap) return cell;
    }
    return undefined;
  };

  // Static option list per monument (costs do not depend on reservations).
  const optionsFor = (m: number): Option[] => {
    const out: Option[] = [];
    for (const c of state.craftsmen) {
      const def = DATA.craftsmen[c.type];
      const hubs = hubsNeeded(state, [m], c.cells, range);
      if (hubs === Infinity) continue;
      const hubCost = hubs * DATA.hubCost;
      const base = { cash: hubCost + price(c), net: netOf(hubPayee, hubCost) + netOf(c.owner, price(c)) };
      if (def.kind === 'primary') {
        if (!primaryGoodUsable(state, c.type)) continue;
        out.push({ type: c.type, craftsman: c, ...base });
      } else {
        for (const pc of state.craftsmen) {
          if (pc.type !== def.needs) continue;
          const h2 = hubsNeeded(state, c.cells, pc.cells, range);
          if (h2 === Infinity) continue;
          const c2 = h2 * DATA.hubCost;
          out.push({
            type: c.type,
            craftsman: c,
            primary: pc,
            cash: base.cash + c2 + price(pc),
            net: base.net + netOf(hubPayee, c2) + netOf(pc.owner, price(pc)),
          });
        }
      }
    }
    return out.sort((a, b) => a.net - b.net || a.cash - b.cash);
  };

  for (const m of monuments) {
    const mon = state.board.cells[m]?.monument;
    if (!mon || mon.owner !== p.id || mon.level >= DATA.maxMonumentLevel) continue;
    const options = optionsFor(m);
    const picked: GoodPurchase[] = [];
    const local = new Map<number, number>();
    const usedTypes = new Set<CraftsmanType>();
    let cash = 0;
    let net = 0;
    for (let k = 0; k < mon.level; k++) {
      let found = false;
      for (const o of options) {
        if (usedTypes.has(o.type) && p.god !== 'tsuiGoab') continue;
        if (plan.cash + cash + o.cash > budget) continue;
        const r1 = freeResource(o.craftsman, local);
        if (r1 === undefined) continue;
        local.set(r1, (local.get(r1) ?? 0) + 1);
        let r2: number | undefined;
        if (o.primary) {
          r2 = freeResource(o.primary, local);
          if (r2 === undefined) {
            local.set(r1, local.get(r1)! - 1);
            continue;
          }
          local.set(r2, (local.get(r2) ?? 0) + 1);
        }
        picked.push({
          monument: m,
          craftsman: o.craftsman.id,
          resource: r1,
          ...(o.primary ? { primary: { craftsman: o.primary.id, resource: r2! } } : {}),
        });
        usedTypes.add(o.type);
        cash += o.cash;
        net += o.net;
        found = true;
        break;
      }
      if (!found) break;
    }
    if (picked.length !== mon.level) continue;
    for (const [cell, n] of local) usage.set(cell, (usage.get(cell) ?? 0) + n);
    plan.goods.push(...picked);
    plan.cash += cash;
    plan.net += net;
    plan.vpGain += DATA.monumentVPByLevel[mon.level + 1] - DATA.monumentVPByLevel[mon.level];
    plan.monuments.push(m);
  }
  return plan;
}

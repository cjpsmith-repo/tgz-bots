import { describe, expect, it } from 'vitest';
import { boardFromRows, distances, hubsNeeded, idx } from '../src/engine/board';
import { applyAction, createGame, currentActor, isLegal, quoteRaise } from '../src/engine/game';
import { planRaise } from '../src/engine/raise';
import { chooseBotAction } from '../src/engine/bot';
import type { CraftsmanType } from '../src/engine/data';
import type { GameState } from '../src/engine/types';

const players = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `P${i}`, isBot: false }));

/** A game already in the action phase on a custom board, player 0 to move. */
function actionGame(rows: string[], n = 2): GameState {
  const s = createGame({ players: players(n), seed: 1, board: boardFromRows(rows) });
  s.phase = 'actions';
  s.round = 1;
  s.turnOrder = s.players.map((p) => p.id);
  s.turnIndex = 0;
  s.turn = { player: 0, choseCard: false, usedSpecialists: [], nomadsActive: false, builderActive: false, firstPrimaries: [], dzivaUsed: false };
  return s;
}

function addMonument(s: GameState, x: number, y: number, owner: number, level: number) {
  s.board.cells[idx(s.board, x, y)]!.monument = { owner, level };
}

function addCraftsman(s: GameState, type: CraftsmanType, owner: number, cells: [number, number][], price: number) {
  const id = s.nextCraftsmanId++;
  const ids = cells.map(([x, y]) => idx(s.board, x, y));
  s.craftsmen.push({ id, type, owner, cells: ids });
  for (const c of ids) s.board.cells[c]!.craftsman = id;
  s.players[owner].techs[type] = { copy: 0, price, vrPaid: 3 };
  s.techTaken[type].push(owner);
  return id;
}

describe('range', () => {
  it('counts a continuous water area as a single step', () => {
    const b = boardFromRows(['.WWWW.', '......']);
    const d = distances(b, [idx(b, 0, 0)], 10, false);
    expect(d.get(idx(b, 5, 0))).toBe(2);
    expect(d.get(idx(b, 5, 1))).toBe(2);
  });

  it('treats diagonally touching water as separate areas', () => {
    const b = boardFromRows(['.W....', '..W...', '......']);
    expect(b.waterArea[idx(b, 1, 0)]).not.toBe(b.waterArea[idx(b, 2, 1)]);
  });

  it('forces a hub when the path passes a monument', () => {
    const s = actionGame(['.......', '.......']);
    // A wall of monuments between the source and the target.
    addMonument(s, 2, 0, 1, 1);
    addMonument(s, 2, 1, 1, 1);
    const from = [idx(s.board, 0, 0)];
    expect(hubsNeeded(s, from, [idx(s.board, 3, 0)], 3)).toBe(1);
    expect(hubsNeeded(s, from, [idx(s.board, 1, 1)], 3)).toBe(0);
  });
});

describe('generosity of kings (rulebook example)', () => {
  it('distributes gifts round the plaques and sets turn order', () => {
    const rows = ['S.S.S.', '......', '......'];
    const s0 = createGame({ players: [
      { name: 'Kilwa', isBot: false },
      { name: 'Zulu', isBot: false },
      { name: 'Mutapa', isBot: false },
    ], seed: 7, board: boardFromRows(rows) });
    // Kilwa needs 23; Mutapa and Zulu need 21 with Mutapa's marker on top.
    s0.players[0].vr = 23;
    s0.players[0].vrSeq = 1;
    s0.players[1].vr = 21;
    s0.players[1].vrSeq = 2;
    s0.players[2].vr = 21;
    s0.players[2].vrSeq = 3;
    s0.players[0].cattle = 7;
    s0.players[1].cattle = 3;
    s0.players[2].cattle = 3;
    let s = s0;
    for (const cell of [0, 2, 4]) s = applyAction(s, { type: 'placeStart', cell });
    expect(s.phase).toBe('bidding');
    expect(s.bidding!.plaques.map((p) => p.owner)).toEqual([0, 1, 2]);
    expect(currentActor(s)).toBe(0);

    s = applyAction(s, { type: 'bid', amount: 2 });
    expect(s.bidding!.plaques.map((p) => p.cattle)).toEqual([1, 1, 0]);
    s = applyAction(s, { type: 'bid', amount: 3 });
    // Mutapa cannot give 4 and passes automatically, becoming third.
    expect(s.bidding!.slots[2]).toBe(2);
    expect(currentActor(s)).toBe(0);
    s = applyAction(s, { type: 'bid', amount: 5 });
    // Zulu cannot give 6: Zulu second, Kilwa first. Plaques paid out.
    expect(s.phase).toBe('actions');
    expect(s.turnOrder).toEqual([0, 1, 2]);
    expect(s.players.map((p) => p.cattle)).toEqual([4, 3, 3 + 3]);
  });
});

describe('raising monuments (rulebook example)', () => {
  // Zulu (player 0) raises a level-2 monument with an ivory carving and a
  // sculpture reached through a hub, and a level-1 monument with ivory.
  function setup() {
    const s = actionGame([
      '....II...T',
      '.........T',
      '..........',
      '..........',
      '..........',
      '..T.......',
    ]);
    addMonument(s, 0, 0, 0, 2); // level-2 monument
    addMonument(s, 3, 3, 0, 1); // level-1 monument, also the hub
    addCraftsman(s, 'ivoryCarver', 1, [[2, 0], [3, 0], [2, 1], [3, 1]], 1);
    addCraftsman(s, 'sculptor', 1, [[6, 0], [7, 0], [6, 1], [7, 1]], 2);
    addCraftsman(s, 'woodCarver', 0, [[0, 4], [0, 5]], 1);
    s.players[0].cattle = 10;
    return s;
  }

  it('prices the sculpture at 5 and the whole raise at 7 for 6 VP', () => {
    const s = setup();
    const z = s.players[0];
    const plan = planRaise(s, z, [idx(s.board, 0, 0), idx(s.board, 3, 3)]);
    expect(plan.monuments.length).toBe(2);
    const q = quoteRaise(s, z, plan.goods);
    expect(q.total).toBe(7);
    expect(q.toStock).toBe(2); // the hub used twice
    expect(q.toPlayers.get(1)).toBe(4); // ivory 1 + 1, sculptor 2
    expect(q.toPlayers.get(0)).toBe(1); // Zulu's own wood carver
    expect(q.vpGain).toBe(6);

    const after = applyAction(s, { type: 'raise', goods: plan.goods });
    expect(after.players[0].cattle).toBe(3);
    expect(after.players[0].pending).toBe(1);
    expect(after.players[1].pending).toBe(4);
    expect(after.board.cells[idx(s.board, 0, 0)]!.monument!.level).toBe(3);
  });

  it('rejects wood carvings once a sculptor is on the map', () => {
    const s = setup();
    const z = s.players[0];
    const wc = s.craftsmen.find((c) => c.type === 'woodCarver')!;
    expect(() =>
      quoteRaise(s, z, [{ monument: idx(s.board, 3, 3), craftsman: wc.id, resource: idx(s.board, 2, 5) }]),
    ).toThrow(/no longer accepted/);
  });

  it('requires different goods for one monument', () => {
    const s = setup();
    const ic = s.craftsmen.find((c) => c.type === 'ivoryCarver')!;
    const m = idx(s.board, 0, 0);
    const goods = [
      { monument: m, craftsman: ic.id, resource: idx(s.board, 4, 0) },
      { monument: m, craftsman: ic.id, resource: idx(s.board, 5, 0) },
    ];
    expect(() => quoteRaise(s, s.players[0], goods)).toThrow(/different/);
    s.players[0].god = 'tsuiGoab';
    expect(quoteRaise(s, s.players[0], goods).total).toBe(2);
  });

  it('does not reuse a resource unless the player adores Atete', () => {
    const s = setup();
    const ic = s.craftsmen.find((c) => c.type === 'ivoryCarver')!;
    s.board.cells[idx(s.board, 4, 0)]!.used = 1;
    const goods = [{ monument: idx(s.board, 3, 3), craftsman: ic.id, resource: idx(s.board, 4, 0) }];
    expect(() => quoteRaise(s, s.players[0], goods)).toThrow(/already been used/);
    s.players[0].god = 'atete';
    expect(quoteRaise(s, s.players[0], goods).total).toBe(1);
  });
});

describe('building', () => {
  it('enforces monument zoning unless the Nomads are hired', () => {
    const s = actionGame(['......', '......', '......']);
    addMonument(s, 0, 0, 1, 1);
    expect(isLegal(s, { type: 'buildMonument', cells: [idx(s.board, 1, 1)] })).toBe(false);
    expect(isLegal(s, { type: 'buildMonument', cells: [idx(s.board, 2, 0)] })).toBe(true);
    s.players[0].specialists.push('nomads');
    s.specialistOwner.nomads = 0;
    s.players[0].cattle = 5;
    const s2 = applyAction(s, { type: 'useNomads' });
    expect(isLegal(s2, { type: 'buildMonument', cells: [idx(s.board, 1, 1)] })).toBe(true);
  });

  it('places a craftsman: tech VR, cost, VP, and a free resource', () => {
    const s = actionGame(['C.......', '........', '........', '.......C']);
    s.players[0].cattle = 5;
    const cells = [idx(s.board, 1, 0), idx(s.board, 1, 1)];
    expect(isLegal(s, { type: 'placeCraftsman', craftsman: 'potter', cells })).toBe(false); // no price
    const s2 = applyAction(s, { type: 'placeCraftsman', craftsman: 'potter', cells, price: 2 });
    const p = s2.players[0];
    expect(p.vr).toBe(23);
    expect(p.cattle).toBe(3);
    expect(p.vp).toBe(1);
    // The second potter must reach clay the first one cannot.
    const near = [idx(s.board, 2, 0), idx(s.board, 2, 1)];
    expect(isLegal(s2, { type: 'placeCraftsman', craftsman: 'potter', cells: near })).toBe(false);
    const far = [idx(s.board, 7, 1), idx(s.board, 7, 2)];
    expect(isLegal(s2, { type: 'placeCraftsman', craftsman: 'potter', cells: far })).toBe(true);
    // A 2x2 craftsman cannot use a 1x2 shape.
    expect(isLegal(s2, { type: 'placeCraftsman', craftsman: 'ivoryCarver', cells: near, price: 1 })).toBe(false);
  });

  it('blocks building the first primary and its secondary in one turn', () => {
    const s = actionGame(['C....C', '......', '......']);
    s.players[0].cattle = 10;
    const s2 = applyAction(s, {
      type: 'placeCraftsman',
      craftsman: 'potter',
      cells: [idx(s.board, 0, 1), idx(s.board, 0, 2)],
      price: 1,
    });
    const vessel = [idx(s.board, 3, 1), idx(s.board, 4, 1), idx(s.board, 3, 2), idx(s.board, 4, 2)];
    expect(() => applyAction(s2, { type: 'placeCraftsman', craftsman: 'vesselMaker', cells: vessel, price: 2 })).toThrow(
      /same turn/,
    );
  });
});

describe('gods', () => {
  it('Gu refunds technology VR retroactively', () => {
    const s = actionGame(['......']);
    s.godsInPlay = ['gu'];
    s.players[0].vr = 26;
    s.players[0].techs = { potter: { copy: 0, price: 1, vrPaid: 3 }, ivoryCarver: { copy: 0, price: 1, vrPaid: 2 } };
    const s2 = applyAction(s, { type: 'chooseGod', god: 'gu' });
    expect(s2.players[0].vr).toBe(26 - 2 - 1 + 4);
  });

  it('cannot take VR above 40', () => {
    const s = actionGame(['......']);
    s.godsInPlay = ['obatala'];
    s.players[0].vr = 35;
    expect(isLegal(s, { type: 'chooseGod', god: 'obatala' })).toBe(false);
  });
});

describe('full games', () => {
  it('bots finish a 3-player game', () => {
    let s = createGame({ players: players(3).map((p) => ({ ...p, isBot: true })), seed: 42 });
    let steps = 0;
    while (s.phase !== 'gameOver' && steps++ < 5000) s = applyAction(s, chooseBotAction(s));
    expect(s.phase).toBe('gameOver');
    const w = s.players[s.winner!];
    expect(w.vp).toBeGreaterThanOrEqual(w.vr);
  });
});

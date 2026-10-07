import './style.css';
import { CRAFTSMAN_TYPES, DATA, RESOURCES, nameOf, type CraftsmanType, type GodId, type Resource, type SpecialistId } from './engine/data';
import { idx, isEmptyLand, orthNeighbors, xy, TILE_SIZE } from './engine/board';
import {
  applyAction,
  craftsmanError,
  craftsmenOfType,
  createGame,
  currentActor,
  giftCost,
  godVR,
  maxGift,
  minGift,
  monumentSpotError,
  techVR,
} from './engine/game';
import { planRaise } from './engine/raise';
import { chooseBotAction } from './engine/bot';
import type { Action, GameState } from './engine/types';

const HUMAN = 0;
const SAVE_KEY = 'tgz-solo-game-v1';
const CELL = 36;

const RESOURCE_ICON: Record<Resource, string> = { clay: '🧱', wood: '🌳', ivory: '🐘', diamonds: '💎' };
const RESOURCE_FILL: Record<Resource, string> = { clay: '#d9874a', wood: '#9a6bb0', ivory: '#c9c25a', diamonds: '#58a9a0' };
const CRAFT_ICON: Record<CraftsmanType, string> = {
  potter: '🏺',
  woodCarver: '🎭',
  ivoryCarver: '💍',
  diamondCutter: '💠',
  vesselMaker: '⚱️',
  sculptor: '🗿',
  throneMaker: '🪑',
};

type Mode =
  | { kind: 'none' }
  | { kind: 'monument'; cells: number[] }
  | { kind: 'craftsman'; type: CraftsmanType; vertical: boolean; price: number }
  | { kind: 'shaman'; resource: Resource }
  | { kind: 'rain'; vertical: boolean }
  | { kind: 'raise'; monuments: number[] };

let game: GameState;
let history: GameState[] = [];
let mode: Mode = { kind: 'none' };
let error = '';
let hover: number | null = null;
let botTimer: number | undefined;
let botDelay = 500;

const app = document.getElementById('app')!;
document.body.insertAdjacentHTML(
  'beforeend',
  `<dialog id="newGame">
      <form method="dialog">
        <h2>New game</h2>
        <label>Your kingdom <input id="ng-name" name="name" value="Zimbabwe" /></label>
        <label>Opponents <select id="ng-opponents" name="opponents"><option>1</option><option>2</option><option selected>3</option><option>4</option></select></label>
        <label><input id="ng-beginner" type="checkbox" name="beginner" /> Beginner setup (6 gods, no specialists)</label>
        <div class="row"><button class="primary" value="start">Start</button><button value="cancel">Cancel</button></div>
      </form>
    </dialog>`,
);
const newGameDialog = document.getElementById('newGame') as HTMLDialogElement;
newGameDialog.addEventListener('close', () => {
  if (newGameDialog.returnValue !== 'start') return;
  const data = new FormData(newGameDialog.querySelector('form')!);
  newGame(Number(data.get('opponents')), data.get('beginner') === 'on', String(data.get('name') || 'Zimbabwe'));
});

// ---------------------------------------------------------------- persistence

function save() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({ game, history: history.slice(-30) }));
  } catch {
    /* storage unavailable */
  }
}

function load(): boolean {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return false;
    const data = JSON.parse(raw);
    if (!data?.game?.board) return false;
    game = data.game;
    history = data.history ?? [];
    return true;
  } catch {
    return false;
  }
}

function newGame(opponents: number, beginner: boolean, name: string) {
  const names = ['Mutapa', 'Kilwa', 'Lozi', 'Mapungubwe'];
  game = createGame({
    players: [{ name: name || 'Zimbabwe', isBot: false }, ...names.slice(0, opponents).map((n) => ({ name: n, isBot: true }))],
    seed: Math.floor(Math.random() * 2 ** 31),
    beginner,
  });
  history = [];
  mode = { kind: 'none' };
  error = '';
  save();
  render();
  scheduleBot();
}

// ---------------------------------------------------------------- actions

function act(action: Action, keepMode = false) {
  try {
    const next = applyAction(game, action, HUMAN);
    history.push(game);
    game = next;
    error = '';
    if (!keepMode) mode = { kind: 'none' };
  } catch (e) {
    error = (e as Error).message;
  }
  save();
  render();
  scheduleBot();
}

function scheduleBot() {
  window.clearTimeout(botTimer);
  if (game.phase === 'gameOver') return;
  const actor = currentActor(game);
  if (actor === null || !game.players[actor].isBot) return;
  botTimer = window.setTimeout(() => {
    game = applyAction(game, chooseBotAction(game));
    save();
    render();
    scheduleBot();
  }, botDelay);
}

function undo() {
  const prev = history.pop();
  if (!prev) return;
  window.clearTimeout(botTimer);
  game = prev;
  mode = { kind: 'none' };
  error = '';
  save();
  render();
  scheduleBot();
}

function humanToMove(): boolean {
  return currentActor(game) === HUMAN;
}

// ---------------------------------------------------------------- board helpers

function craftsmanCells(anchor: number, type: CraftsmanType, vertical: boolean): number[] | null {
  const b = game.board;
  let [w, h] = DATA.craftsmen[type].footprint;
  if (vertical) [w, h] = [h, w];
  const [x0, y0] = xy(b, anchor);
  const out: number[] = [];
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      const x = x0 + dx;
      const y = y0 + dy;
      if (x >= b.width || y >= b.height || !b.cells[idx(b, x, y)]) return null;
      out.push(idx(b, x, y));
    }
  }
  return out;
}

function rainCells(anchor: number, vertical: boolean): [number, number] | null {
  const b = game.board;
  const [x, y] = xy(b, anchor);
  const x2 = vertical ? x : x + 1;
  const y2 = vertical ? y + 1 : y;
  if (x2 >= b.width || y2 >= b.height) return null;
  const other = idx(b, x2, y2);
  return orthNeighbors(b, anchor).includes(other) ? [anchor, other] : null;
}

/** Cells to highlight as clickable for the current mode. */
function legalCells(): Set<number> {
  const out = new Set<number>();
  if (!humanToMove()) return out;
  const b = game.board;
  const me = game.players[HUMAN];
  b.cells.forEach((c, i) => {
    if (!c) return;
    if (game.phase === 'setup') {
      if (c.start && !c.monument) out.add(i);
      return;
    }
    switch (mode.kind) {
      case 'monument':
        if (!monumentSpotError(game, i, game.turn!.nomadsActive) && !mode.cells.includes(i)) out.add(i);
        break;
      case 'craftsman': {
        const cells = craftsmanCells(i, mode.type, mode.vertical);
        if (cells && !craftsmanError(game, me, mode.type, cells, mode.price)) out.add(i);
        break;
      }
      case 'shaman':
        if (isEmptyLand(c)) out.add(i);
        break;
      case 'rain': {
        const cells = rainCells(i, mode.vertical);
        if (cells && isEmptyLand(b.cells[cells[0]]) && isEmptyLand(b.cells[cells[1]])) out.add(i);
        break;
      }
      case 'raise':
        if (c.monument?.owner === HUMAN && c.monument.level < DATA.maxMonumentLevel) out.add(i);
        break;
    }
  });
  return out;
}

function onCellClick(i: number) {
  if (!humanToMove()) return;
  if (game.phase === 'setup') return act({ type: 'placeStart', cell: i });
  const me = game.players[HUMAN];
  switch (mode.kind) {
    case 'monument': {
      const cells = [...mode.cells, i];
      if (me.god === 'obatala' && cells.length < 2) {
        const err = monumentSpotError(game, i, game.turn!.nomadsActive);
        if (err) {
          error = err;
          return render();
        }
        mode = { kind: 'monument', cells };
        return render();
      }
      return act({ type: 'buildMonument', cells });
    }
    case 'craftsman': {
      const cells = craftsmanCells(i, mode.type, mode.vertical);
      if (!cells) return;
      const needsPrice = !me.techs[mode.type];
      return act({ type: 'placeCraftsman', craftsman: mode.type, cells, ...(needsPrice ? { price: mode.price } : {}) }, true);
    }
    case 'shaman':
      return act({ type: 'useShaman', resource: mode.resource, cell: i });
    case 'rain': {
      const cells = rainCells(i, mode.vertical);
      if (cells) act({ type: 'useRain', cells });
      return;
    }
    case 'raise': {
      const c = game.board.cells[i];
      if (c?.monument?.owner !== HUMAN) return;
      const ms = mode.monuments.includes(i) ? mode.monuments.filter((m) => m !== i) : [...mode.monuments, i];
      mode = { kind: 'raise', monuments: ms };
      return render();
    }
  }
}

function possessive(id: number): string {
  return id === HUMAN ? 'Your' : `${game.players[id].name}'s`;
}

function describeCell(i: number): string {
  const c = game.board.cells[i];
  if (!c) return '';
  const parts: string[] = [];
  if (c.water) parts.push('Water');
  if (c.start && !c.monument) parts.push('Starting area');
  if (c.resource) parts.push(`${nameOf(c.resource)}${c.used ? ` (used ×${c.used})` : ''}`);
  if (c.monument) parts.push(`${possessive(c.monument.owner)} monument, level ${c.monument.level}`);
  if (c.craftsman !== undefined) {
    const cm = game.craftsmen.find((k) => k.id === c.craftsman)!;
    const owner = game.players[cm.owner];
    parts.push(`${possessive(cm.owner)} ${nameOf(cm.type)}, ${owner.techs[cm.type]!.price} cattle per good`);
  }
  if (!parts.length) parts.push('Empty land');
  return parts.join(' · ');
}

// ---------------------------------------------------------------- rendering

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
}

function textColorFor(bg: string): string {
  return ['#f1c40f', '#f4f1ea'].includes(bg) ? '#222' : '#fff';
}

function renderBoard(): string {
  const b = game.board;
  const W = b.width * CELL;
  const H = b.height * CELL;
  const legal = legalCells();
  const parts: string[] = [];

  // Preview footprint for craftsman / rain placement under the mouse.
  let preview: number[] = [];
  let previewOk = false;
  if (hover !== null && humanToMove()) {
    if (mode.kind === 'craftsman') preview = craftsmanCells(hover, mode.type, mode.vertical) ?? [];
    else if (mode.kind === 'rain') preview = rainCells(hover, mode.vertical) ?? [];
    previewOk = legal.has(hover);
  }

  b.cells.forEach((c, i) => {
    if (!c) return;
    const [x, y] = xy(b, i);
    const px = x * CELL;
    const py = y * CELL;
    const alt = (Math.floor(x / TILE_SIZE) + Math.floor(y / TILE_SIZE)) % 2 === 0;
    const fill = c.water ? 'var(--water)' : alt ? 'var(--land)' : 'var(--land-alt)';
    parts.push(`<rect x="${px}" y="${py}" width="${CELL}" height="${CELL}" fill="${fill}" stroke="${c.water ? 'var(--water-edge)' : '#0001'}" />`);
    if (c.start) {
      parts.push(`<rect x="${px + 4}" y="${py + 4}" width="${CELL - 8}" height="${CELL - 8}" rx="4" fill="#8884" stroke="#555" stroke-dasharray="3 2" />`);
    }
    if (c.resource) {
      parts.push(`<rect x="${px + 3}" y="${py + 3}" width="${CELL - 6}" height="${CELL - 6}" rx="5" fill="${RESOURCE_FILL[c.resource]}" />`);
      parts.push(`<text x="${px + CELL / 2}" y="${py + CELL / 2 + 6}" font-size="17" text-anchor="middle">${RESOURCE_ICON[c.resource]}</text>`);
      for (let u = 0; u < c.used; u++) {
        parts.push(`<text x="${px + CELL - 8 - u * 9}" y="${py + 12}" font-size="12" font-weight="700" fill="#3b1d0e" text-anchor="middle">✕</text>`);
      }
    }
  });

  // Tile borders.
  for (let ty = 0; ty < b.height / TILE_SIZE; ty++) {
    for (let tx = 0; tx < b.width / TILE_SIZE; tx++) {
      if (!b.cells[idx(b, tx * TILE_SIZE, ty * TILE_SIZE)]) continue;
      parts.push(`<rect x="${tx * TILE_SIZE * CELL}" y="${ty * TILE_SIZE * CELL}" width="${TILE_SIZE * CELL}" height="${TILE_SIZE * CELL}" fill="none" stroke="#5a4630" stroke-width="2" />`);
    }
  }

  for (const cm of game.craftsmen) {
    const pts = cm.cells.map((c) => xy(b, c));
    const x0 = Math.min(...pts.map((p) => p[0]));
    const y0 = Math.min(...pts.map((p) => p[1]));
    const x1 = Math.max(...pts.map((p) => p[0]));
    const y1 = Math.max(...pts.map((p) => p[1]));
    const owner = game.players[cm.owner];
    const w = (x1 - x0 + 1) * CELL;
    const h = (y1 - y0 + 1) * CELL;
    const cx = x0 * CELL + w / 2;
    const cy = y0 * CELL + h / 2;
    parts.push(`<rect x="${x0 * CELL + 2}" y="${y0 * CELL + 2}" width="${w - 4}" height="${h - 4}" rx="6" fill="#fffbf2" stroke="${owner.color === '#f4f1ea' ? '#999' : owner.color}" stroke-width="4" />`);
    parts.push(`<text x="${cx}" y="${cy + 2}" font-size="${Math.min(w, h) * 0.5}" text-anchor="middle">${CRAFT_ICON[cm.type]}</text>`);
    parts.push(`<text x="${cx}" y="${y1 * CELL + CELL - 6}" font-size="11" font-weight="700" text-anchor="middle" fill="#222">${owner.techs[cm.type]!.price}🐄</text>`);
  }

  b.cells.forEach((c, i) => {
    if (!c?.monument) return;
    const [x, y] = xy(b, i);
    const owner = game.players[c.monument.owner];
    const cx = x * CELL + CELL / 2;
    const cy = y * CELL + CELL / 2;
    parts.push(`<circle cx="${cx}" cy="${cy}" r="${CELL * 0.4}" fill="${owner.color}" stroke="#222" stroke-width="1.5" />`);
    parts.push(`<text x="${cx}" y="${cy + 6}" font-size="17" font-weight="700" text-anchor="middle" fill="${textColorFor(owner.color)}">${c.monument.level}</text>`);
  });

  for (const i of legal) {
    const [x, y] = xy(b, i);
    parts.push(`<rect x="${x * CELL + 1.5}" y="${y * CELL + 1.5}" width="${CELL - 3}" height="${CELL - 3}" fill="#3aa65a22" stroke="var(--legal)" stroke-width="2" rx="3" />`);
  }
  const selected = mode.kind === 'monument' ? mode.cells : mode.kind === 'raise' ? mode.monuments : [];
  for (const i of selected) {
    const [x, y] = xy(b, i);
    parts.push(`<rect x="${x * CELL + 1}" y="${y * CELL + 1}" width="${CELL - 2}" height="${CELL - 2}" fill="none" stroke="var(--select)" stroke-width="4" rx="4" />`);
  }
  for (const i of preview) {
    const [x, y] = xy(b, i);
    parts.push(`<rect x="${x * CELL}" y="${y * CELL}" width="${CELL}" height="${CELL}" fill="${previewOk ? '#3aa65a66' : '#c0392b55'}" />`);
  }

  // Invisible hit targets on top.
  b.cells.forEach((c, i) => {
    if (!c) return;
    const [x, y] = xy(b, i);
    parts.push(`<rect data-cell="${i}" x="${x * CELL}" y="${y * CELL}" width="${CELL}" height="${CELL}" fill="transparent" style="cursor:${legal.has(i) ? 'pointer' : 'default'}" />`);
  });

  return `<svg class="board" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">${parts.join('')}</svg>`;
}

function renderPlayers(): string {
  const actor = currentActor(game);
  const order = game.phase === 'actions' ? game.turnOrder : game.players.map((p) => p.id);
  const rows = order.map((id) => {
    const p = game.players[id];
    const techs = CRAFTSMAN_TYPES.filter((t) => p.techs[t])
      .map((t) => `${CRAFT_ICON[t]}${p.techs[t]!.price}`)
      .join(' ');
    const extras = [p.god ? nameOf(p.god) : '', ...p.specialists.map(nameOf)].filter(Boolean).join(', ');
    return `<tr class="${actor === id ? 'active' : ''}">
      <td><span class="swatch" style="background:${p.color}"></span>${esc(p.name)}${p.isBot ? '' : ' (you)'}</td>
      <td>${p.cattle}${p.pending ? `<span class="small"> +${p.pending}</span>` : ''}</td>
      <td><b>${p.vp}</b>/${p.vr}</td>
      <td class="small">${extras}${extras && techs ? '<br>' : ''}${techs}</td>
    </tr>`;
  });
  return `<div class="card"><h2>Kingdoms</h2>
    <table class="players"><tr><th>Player</th><th>🐄</th><th>VP/VR</th><th>Gods, cards</th></tr>${rows.join('')}</table>
    <div class="small">🐄 cattle (+ on cards, paid at revenue). VP/VR: points / points needed to win.</div></div>`;
}

function renderBidding(): string {
  const b = game.bidding!;
  const me = game.players[HUMAN];
  const plaques = b.plaques
    .map((pl) => {
      const name = pl.owner === -1 ? 'Shadipinyi' : game.players[pl.owner].name;
      return `${esc(name)}: ${pl.cattle}`;
    })
    .join(' · ');
  let body = `<div class="small">Plaques: ${plaques}</div>`;
  if (humanToMove()) {
    const min = minGift(game);
    const max = Math.min(maxGift(game, me), min + 7);
    const buttons: string[] = [];
    for (let n = min; n <= max; n++) {
      const cost = giftCost(game, me, n);
      buttons.push(`<button data-cmd="bid" data-arg="${n}">Give ${n}${cost !== n ? ` (pay ${cost})` : ''}</button>`);
    }
    body += `<div class="hint">Generosity of kings: give cattle to go earlier in the turn order. Gifts are spread over all plaques (yours included). The last to keep giving moves first.</div>
      <div class="row">${buttons.join('')}<button data-cmd="pass">Pass</button></div>`;
  } else {
    body += `<div class="small">Waiting for ${esc(game.players[currentActor(game)!].name)}…</div>`;
  }
  return `<div class="card"><h2>Round ${game.round} · Turn order bidding</h2>${body}</div>`;
}

function renderRaisePanel(): string {
  if (mode.kind !== 'raise') return '';
  const me = game.players[HUMAN];
  if (!mode.monuments.length) return `<div class="hint">Click your monuments to raise them (one level each).</div>`;
  const plan = planRaise(game, me, mode.monuments);
  const skipped = mode.monuments.filter((m) => !plan.monuments.includes(m));
  const lines = plan.goods.map((g) => {
    const cm = game.craftsmen.find((c) => c.id === g.craftsman)!;
    const pc = g.primary ? game.craftsmen.find((c) => c.id === g.primary!.craftsman) : undefined;
    const who = (owner: number) => (owner === HUMAN ? 'your' : `${game.players[owner].name}'s`);
    return `<li>${CRAFT_ICON[cm.type]} ${nameOf(cm.type)} (${who(cm.owner)})${pc ? ` + ${CRAFT_ICON[pc.type]} ${nameOf(pc.type)} (${who(pc.owner)})` : ''}</li>`;
  });
  let html = `<div class="hint">Cheapest sourcing found: <b>${plan.cash} cattle</b> (${plan.net} to others/stock), <b>+${plan.vpGain} VP</b>.</div>`;
  html += `<ul class="goods">${lines.join('')}</ul>`;
  if (skipped.length) html += `<div class="error">${skipped.length} selected monument(s) cannot be supplied with your cattle and the goods in range.</div>`;
  html += `<div class="row"><button class="primary" data-cmd="confirmRaise" ${plan.goods.length ? '' : 'disabled'}>Raise for ${plan.cash} cattle</button><button data-cmd="cancelMode">Cancel</button></div>`;
  return html;
}

function renderCraftsmanPanel(): string {
  if (mode.kind !== 'craftsman') return '';
  const me = game.players[HUMAN];
  const m = mode;
  const buttons = CRAFTSMAN_TYPES.map((t) => {
    const def = DATA.craftsmen[t];
    const owned = !!me.techs[t];
    const left = DATA.supply.craftsmenPerType - craftsmenOfType(game, t).length;
    const techLeft = owned || game.techTaken[t].length < 2;
    const vr = owned ? '' : ` VR+${techVR(game, me, t)}`;
    const disabled = !techLeft || left <= 0 || me.cattle < def.cost;
    return `<button data-cmd="craftType" data-arg="${t}" class="${m.type === t ? 'on' : ''}" ${disabled ? 'disabled' : ''} title="${def.kind}, uses ${def.resource}${def.needs ? ' + ' + nameOf(def.needs) : ''}">${CRAFT_ICON[t]} ${nameOf(t)} · ${def.cost}🐄 · ${def.vp}VP${vr}</button>`;
  }).join('');
  const def = DATA.craftsmen[m.type];
  const rotatable = def.footprint[0] !== def.footprint[1];
  const needsPrice = !me.techs[m.type];
  return `<div class="hint">Choose a craftsman, then click the top-left area to place it. ${def.kind === 'secondary' ? `Needs ${def.resource} in range and a ${nameOf(def.needs!)} reachable (hubs allowed).` : `Needs ${def.resource} in range that no other ${nameOf(m.type)} reaches.`}</div>
    <div class="row">${buttons}</div>
    <div class="row">
      ${rotatable ? `<button data-cmd="rotate">Rotate (${m.vertical ? 'vertical' : 'horizontal'})</button>` : ''}
      ${needsPrice ? `New technology price: <select data-cmd="craftPrice">${[1, 2, 3].map((v) => `<option ${v === m.price ? 'selected' : ''}>${v}</option>`).join('')}</select>` : ''}
      <button data-cmd="cancelMode">Done placing</button>
    </div>`;
}

function renderActions(): string {
  const t = game.turn!;
  const me = game.players[HUMAN];
  if (!humanToMove()) {
    return `<div class="card"><h2>Round ${game.round} · Actions</h2><div class="small">${esc(game.players[t.player].name)} is taking their turn…</div></div>`;
  }
  const parts: string[] = [];
  parts.push(`<div class="hint">Your turn. Optionally adore a god <i>or</i> take a specialist, use your specialists, then take <b>one</b> main action: build a monument, place craftsmen, or raise monuments.</div>`);

  parts.push(`<h3>Main action</h3>`);
  if (!t.mainAction || t.mainAction === 'craftsmen') {
    const monumentLabel = me.god === 'obatala' ? 'Build monuments (up to 2)' : 'Build a monument';
    parts.push(`<div class="row">
      ${!t.mainAction ? `<button data-cmd="monumentMode" class="${mode.kind === 'monument' ? 'on' : ''}">${monumentLabel}</button>` : ''}
      <button data-cmd="craftMode" class="${mode.kind === 'craftsman' ? 'on' : ''}">Place craftsmen</button>
      ${!t.mainAction ? `<button data-cmd="raiseMode" class="${mode.kind === 'raise' ? 'on' : ''}">Raise monuments</button>` : ''}
    </div>`);
  } else {
    parts.push(`<div class="small">Done: ${t.mainAction === 'monument' ? 'built' : 'raised'} monuments.</div>`);
  }
  if (mode.kind === 'monument') {
    parts.push(`<div class="hint">Click empty land not next to another monument${t.nomadsActive ? ' (Nomads: zoning ignored)' : ''}.</div>`);
    if (mode.cells.length) parts.push(`<div class="row"><button class="primary" data-cmd="confirmMonuments">Build 1 monument</button><button data-cmd="cancelMode">Cancel</button></div>`);
  }
  parts.push(renderCraftsmanPanel());
  parts.push(renderRaisePanel());

  if (!t.choseCard && !me.god) {
    const gods = game.godsInPlay.filter((g) => game.godOwner[g] === undefined);
    if (gods.length) {
      parts.push(`<h3>Gods</h3>`);
      for (const g of gods) {
        const vr = godVR(me, g);
        parts.push(`<div class="choice"><b>${nameOf(g)}</b> → VR ${vr} <button data-cmd="god" data-arg="${g}" ${vr > DATA.maxVR ? 'disabled' : ''}>Adore</button><div class="small">${esc(DATA.gods[g].effect)}</div></div>`);
      }
    }
  }
  if (!t.choseCard) {
    const specs = game.specialistsInPlay.filter((s) => game.specialistOwner[s] === undefined);
    if (specs.length) {
      parts.push(`<h3>Specialists</h3>`);
      for (const s of specs) {
        const d = DATA.specialists[s];
        parts.push(`<div class="choice"><b>${nameOf(s)}</b> VR+${d.vr}, ${d.useCost}🐄 per use <button data-cmd="spec" data-arg="${s}" ${me.vr + d.vr > DATA.maxVR || me.cattle < d.useCost ? 'disabled' : ''}>Take</button><div class="small">${esc(d.effect)}</div></div>`);
      }
    }
  }
  const usable = me.specialists.filter((s) => !t.usedSpecialists.includes(s));
  if (usable.length) {
    parts.push(`<h3>Your specialists</h3><div class="row">`);
    for (const s of usable) {
      if (s === 'herd') {
        for (const n of [1, 2, 3]) parts.push(`<button data-cmd="herd" data-arg="${n}" ${me.cattle < 2 * n ? 'disabled' : ''}>Herd: pay ${2 * n}, get ${3 * n}</button>`);
      } else if (s === 'shaman') {
        parts.push(`<button data-cmd="shamanMode">Shaman: place resource (2🐄)</button>`);
      } else if (s === 'rainCeremony') {
        parts.push(`<button data-cmd="rainMode">Rain: place water (3🐄)</button>`);
      } else {
        parts.push(`<button data-cmd="${s}">${nameOf(s)} (2🐄)</button>`);
      }
    }
    parts.push(`</div>`);
    if (t.newSpecialist) parts.push(`<div class="small">You must use the ${nameOf(t.newSpecialist)} this turn.</div>`);
  }
  if (mode.kind === 'shaman') {
    const m = mode;
    parts.push(`<div class="hint">Choose a resource, then click empty land.</div><div class="row">${RESOURCES.map((r) => `<button data-cmd="shamanRes" data-arg="${r}" class="${m.resource === r ? 'on' : ''}" ${game.supply.resources[r] <= 0 ? 'disabled' : ''}>${RESOURCE_ICON[r]} ${r} (${game.supply.resources[r]})</button>`).join('')}<button data-cmd="cancelMode">Cancel</button></div>`);
  }
  if (mode.kind === 'rain') {
    parts.push(`<div class="hint">Click empty land to flood two areas.</div><div class="row"><button data-cmd="rotate">Rotate (${mode.vertical ? 'vertical' : 'horizontal'})</button><button data-cmd="cancelMode">Cancel</button></div>`);
  }

  const owned = CRAFTSMAN_TYPES.filter((ty) => me.techs[ty]);
  const canPrice = owned.length && (t.mainAction === 'craftsmen' || (me.god === 'dziva' && !t.dzivaUsed));
  if (canPrice) {
    parts.push(`<h3>Prices</h3><div class="row">${owned
      .map((ty) => `${CRAFT_ICON[ty]} <select data-price="${ty}">${[1, 2, 3].map((v) => `<option ${v === me.techs[ty]!.price ? 'selected' : ''}>${v}</option>`).join('')}</select>`)
      .join(' ')}<button data-cmd="setPrices">Set prices</button></div>
      <div class="small">${me.god === 'dziva' ? 'Dziva lets you lower prices once per turn.' : 'Prices can only be raised.'}</div>`);
  }

  parts.push(`<div class="error">${esc(error)}</div>`);
  parts.push(`<div class="row"><button class="primary" data-cmd="endTurn">End turn</button></div>`);
  return `<div class="card"><h2>Round ${game.round} · Your turn</h2>${parts.join('')}</div>`;
}

function renderPhaseCard(): string {
  switch (game.phase) {
    case 'setup':
      return `<div class="card"><h2>Setup</h2>${
        humanToMove()
          ? '<div class="hint">Click a highlighted starting area to place your first monument.</div>'
          : `<div class="small">${esc(game.players[currentActor(game)!].name)} is choosing a starting area…</div>`
      }<div class="error">${esc(error)}</div></div>`;
    case 'bidding':
      return renderBidding() + (error ? `<div class="error">${esc(error)}</div>` : '');
    case 'actions':
      return renderActions();
    case 'gameOver': {
      const w = game.players[game.winner!];
      return `<div class="card"><h2>Game over</h2><p><b>${esc(w.name)}</b> wins with ${w.vp} VP (needed ${w.vr}) after ${game.round} rounds.</p><button class="primary" data-cmd="newGameDialog">New game</button></div>`;
    }
  }
}

function renderAvailable(): string {
  const gods = game.godsInPlay.map((g) => {
    const owner = game.godOwner[g];
    return `<span title="${esc(DATA.gods[g].effect)}">${nameOf(g)}${owner !== undefined ? ` <span class="swatch" style="background:${game.players[owner].color}"></span>` : ''}</span>`;
  });
  const techs = CRAFTSMAN_TYPES.map((t) => {
    const taken = game.techTaken[t].length;
    return `${CRAFT_ICON[t]} ${2 - taken} left`;
  });
  return `<div class="card"><h2>Reference</h2>
    <div class="small"><b>Gods:</b> ${gods.join(', ')}</div>
    <div class="small"><b>Technologies:</b> ${techs.join(' · ')}</div>
    <div class="small"><b>Supply:</b> ${RESOURCES.map((r) => `${RESOURCE_ICON[r]}${game.supply.resources[r]}`).join(' ')} 🌊${game.supply.water}</div>
    <div class="small"><b>Monument VP:</b> level 1–5 = 1, 3, 7, 13, 21. Raising level N needs N different ritual goods.</div></div>`;
}

function renderLog(): string {
  const lines = game.log.slice(-80).map((l) => `<div>${esc(l)}</div>`);
  return `<div class="card"><h2>Log</h2><div class="log" id="log">${lines.join('')}</div></div>`;
}

function render() {
  const actor = currentActor(game);
  const status =
    game.phase === 'gameOver'
      ? 'Game over'
      : `Round ${game.round || '–'} · ${game.phase === 'setup' ? 'setup' : game.phase === 'bidding' ? 'turn order bidding' : 'actions'} · ${actor !== null ? esc(game.players[actor].name) + ' to move' : ''}`;
  app.innerHTML = `
    <header>
      <h1>TGZ Solo</h1>
      <span class="status">${status}</span>
      <button data-cmd="undo" ${history.length ? '' : 'disabled'}>Undo</button>
      <label class="small">Bot speed <select data-cmd="speed">${[
        [1200, 'slow'],
        [500, 'normal'],
        [150, 'fast'],
      ].map(([v, l]) => `<option value="${v}" ${v === botDelay ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <button data-cmd="newGameDialog">New game</button>
    </header>
    <main>
      <div class="board-wrap">${renderBoard()}<div class="cell-info">${hover !== null ? esc(describeCell(hover)) : '&nbsp;'}</div></div>
      <div class="side">${renderPhaseCard()}${renderPlayers()}${renderAvailable()}${renderLog()}</div>
    </main>`;
  const log = document.getElementById('log');
  if (log) log.scrollTop = log.scrollHeight;
}

// ---------------------------------------------------------------- events

app.addEventListener('click', (ev) => {
  const target = ev.target as HTMLElement;
  const cellEl = target.closest('[data-cell]');
  if (cellEl) return onCellClick(Number(cellEl.getAttribute('data-cell')));
  const btn = target.closest('button[data-cmd]') as HTMLButtonElement | null;
  if (!btn || btn.disabled) return;
  const cmd = btn.dataset.cmd!;
  const arg = btn.dataset.arg ?? '';
  const me = game.players[HUMAN];
  switch (cmd) {
    case 'bid':
      return act({ type: 'bid', amount: Number(arg) });
    case 'pass':
      return act({ type: 'pass' });
    case 'god':
      return act({ type: 'chooseGod', god: arg as GodId }, true);
    case 'spec':
      return act({ type: 'chooseSpecialist', specialist: arg as SpecialistId }, true);
    case 'herd':
      return act({ type: 'useHerd', times: Number(arg) }, true);
    case 'nomads':
      return act({ type: 'useNomads' }, true);
    case 'builder':
      return act({ type: 'useBuilder' }, true);
    case 'shamanMode':
      mode = { kind: 'shaman', resource: RESOURCES.find((r) => game.supply.resources[r] > 0) ?? 'clay' };
      break;
    case 'shamanRes':
      if (mode.kind === 'shaman') mode = { kind: 'shaman', resource: arg as Resource };
      break;
    case 'rainMode':
      mode = { kind: 'rain', vertical: false };
      break;
    case 'monumentMode':
      mode = { kind: 'monument', cells: [] };
      break;
    case 'confirmMonuments':
      if (mode.kind === 'monument') return act({ type: 'buildMonument', cells: mode.cells });
      break;
    case 'craftMode': {
      const first = CRAFTSMAN_TYPES.find((t) => me.techs[t]) ?? 'potter';
      mode = { kind: 'craftsman', type: first, vertical: false, price: 2 };
      break;
    }
    case 'craftType':
      if (mode.kind === 'craftsman') mode = { ...mode, type: arg as CraftsmanType };
      break;
    case 'rotate':
      if (mode.kind === 'craftsman' || mode.kind === 'rain') mode = { ...mode, vertical: !mode.vertical };
      break;
    case 'raiseMode':
      mode = { kind: 'raise', monuments: [] };
      break;
    case 'confirmRaise':
      if (mode.kind === 'raise') {
        const plan = planRaise(game, me, mode.monuments);
        return act({ type: 'raise', goods: plan.goods });
      }
      break;
    case 'setPrices': {
      const prices: Partial<Record<CraftsmanType, number>> = {};
      document.querySelectorAll<HTMLSelectElement>('select[data-price]').forEach((s) => {
        const ty = s.dataset.price as CraftsmanType;
        if (Number(s.value) !== me.techs[ty]!.price) prices[ty] = Number(s.value);
      });
      if (!Object.keys(prices).length) {
        error = 'No prices changed';
        break;
      }
      return act({ type: 'setPrices', prices }, true);
    }
    case 'endTurn':
      return act({ type: 'endTurn' });
    case 'cancelMode':
      mode = { kind: 'none' };
      break;
    case 'undo':
      return undo();
    case 'newGameDialog':
      newGameDialog.returnValue = '';
      newGameDialog.showModal();
      return;
  }
  error = cmd === 'setPrices' ? error : '';
  render();
});

app.addEventListener('change', (ev) => {
  const el = ev.target as HTMLSelectElement;
  if (el.dataset.cmd === 'speed') botDelay = Number(el.value);
  if (el.dataset.cmd === 'craftPrice' && mode.kind === 'craftsman') {
    mode = { ...mode, price: Number(el.value) };
    render();
  }
});

app.addEventListener('mouseover', (ev) => {
  const cellEl = (ev.target as HTMLElement).closest('[data-cell]');
  const next = cellEl ? Number(cellEl.getAttribute('data-cell')) : null;
  if (next !== hover) {
    hover = next;
    // Re-render only when the hover preview or info line changes.
    const info = document.querySelector('.cell-info');
    if (mode.kind === 'craftsman' || mode.kind === 'rain') render();
    else if (info) info.textContent = hover !== null ? describeCell(hover) : '';
  }
});

document.addEventListener('keydown', (ev) => {
  if ((ev.key === 'r' || ev.key === 'R') && (mode.kind === 'craftsman' || mode.kind === 'rain')) {
    mode = { ...mode, vertical: !mode.vertical };
    render();
  }
  if (ev.key === 'Escape' && mode.kind !== 'none') {
    mode = { kind: 'none' };
    render();
  }
});

if (!load()) newGame(3, false, 'Zimbabwe');
else {
  render();
  scheduleBot();
}

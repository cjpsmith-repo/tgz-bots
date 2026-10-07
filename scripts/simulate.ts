// Run bot-only games to check the engine end to end: npm run sim -- [games] [players]
import { createGame, applyAction } from '../src/engine/game';
import { chooseBotAction } from '../src/engine/bot';
import { nameOf } from '../src/engine/data';

const games = Number(process.argv[2] ?? 5);
const nPlayers = Number(process.argv[3] ?? 4);
const beginner = process.argv.includes('--beginner');

for (let g = 0; g < games; g++) {
  const t0 = Date.now();
  let s = createGame({
    players: Array.from({ length: nPlayers }, (_, i) => ({ name: `Bot${i + 1}`, isBot: true })),
    seed: 1000 + g,
    beginner,
  });
  let steps = 0;
  while (s.phase !== 'gameOver') {
    s = applyAction(s, chooseBotAction(s));
    if (++steps > 20000) throw new Error('Game did not finish');
  }
  const w = s.players[s.winner!];
  const summary = s.players
    .map((p) => `${p.name} ${p.vp}/${p.vr}${p.god ? ' ' + nameOf(p.god) : ''} c${s.craftsmen.filter((c) => c.owner === p.id).length}`)
    .join(' | ');
  console.log(`game ${g}: ${s.round} rounds, ${steps} actions, ${Date.now() - t0} ms, winner ${w.name}. ${summary}`);
}

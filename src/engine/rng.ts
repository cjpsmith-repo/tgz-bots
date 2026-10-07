/** Small deterministic RNG (mulberry32). State is a single 32-bit number kept in the game state. */
export function nextRandom(state: number): [number, number] {
  let t = (state + 0x6d2b79f5) | 0;
  const next = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, next];
}

export function randInt(n: number, state: number): [number, number] {
  const [v, s] = nextRandom(state);
  return [Math.floor(v * n), s];
}

export function shuffle<T>(items: T[], state: number): [T[], number] {
  const out = items.slice();
  let s = state;
  for (let i = out.length - 1; i > 0; i--) {
    let j: number;
    [j, s] = randInt(i + 1, s);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return [out, s];
}

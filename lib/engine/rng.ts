/**
 * A small seedable random number generator, used everywhere in the engine
 * instead of Math.random(). Two reasons: tests need reproducible output
 * (same seed -> same simulated prices, every run, forever), and a real game
 * session should be able to replay or audit "what exactly happened" without
 * the randomness itself being a black box.
 *
 * mulberry32 — not cryptographically secure, doesn't need to be; it's fast,
 * has no external dependency, and passes the usual statistical smell tests
 * for a game's worth of randomness.
 */

export type Rng = () => number; // returns a float in [0, 1)

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  return function rng() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Standard normal sample (mean 0, standard deviation 1) via the Box-Muller
 * transform, built on top of the uniform `rng`.
 */
export function randomNormal(rng: Rng): number {
  let u = 0;
  let v = 0;
  while (u === 0) u = rng(); // avoid Math.log(0)
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

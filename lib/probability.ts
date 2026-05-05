import { CardEffect, ProbStep } from "./types";

interface ProbState {
  deck: number;
  hand: number;
  unseenDeck: number[];
  seenDeck: number[];
  seenHand: number[];
  hits: number[];
}

function comb(n: number, k: number): number {
  n = Math.floor(n);
  k = Math.floor(k);
  if (k < 0 || k > n) return 0;
  k = Math.min(k, n - k);
  let result = 1;
  for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i;
  return result;
}

function stateKey(s: ProbState): string {
  return [s.deck, s.hand, ...s.unseenDeck, ...s.seenDeck, ...s.seenHand, ...s.hits].join("|");
}

function addDist(map: Map<string, { state: ProbState; prob: number }>, state: ProbState, prob: number) {
  if (prob <= 0) return;
  const key = stateKey(state);
  const prev = map.get(key);
  if (prev) prev.prob += prob;
  else map.set(key, { state, prob });
}

function splitComb(totalA: number, totalB: number, take: number, maxTake: number) {
  const out: { a: number; ways: number }[] = [];
  for (let a = 0; a <= Math.min(totalA, take, maxTake); a++) {
    const b = take - a;
    if (b < 0 || b > totalB) continue;
    out.push({ a, ways: comb(totalA, a) * comb(totalB, b) });
  }
  return out;
}

function enumerateDraw(state: ProbState, draw: number) {
  const n = Math.min(draw, state.deck);
  const u = state.unseenDeck;
  const sd = state.seenDeck;
  const targetDeck = u.reduce((a, b) => a + b, 0) + sd.reduce((a, b) => a + b, 0);
  const other = state.deck - targetDeck;
  const totalWays = comb(state.deck, n);
  const results: { unseenDrawn: number[]; seenDrawn: number[]; prob: number }[] = [];
  if (totalWays <= 0 || other < 0) return results;

  function walk(i: number, used: number, unseenDrawn: number[], seenDrawn: number[], ways: number) {
    if (i === u.length) {
      const otherDrawn = n - used;
      if (otherDrawn < 0 || otherDrawn > other) return;
      results.push({ unseenDrawn, seenDrawn, prob: (ways * comb(other, otherDrawn)) / totalWays });
      return;
    }
    const maxFromCat = u[i] + sd[i];
    const maxTake = Math.min(maxFromCat, n - used);
    for (let take = 0; take <= maxTake; take++) {
      for (const split of splitComb(u[i], sd[i], take, maxTake)) {
        walk(i + 1, used + take, [...unseenDrawn, split.a], [...seenDrawn, take - split.a], ways * split.ways);
      }
    }
  }

  walk(0, 0, [], [], 1);
  return results;
}

function applyDraw(state: ProbState, draw: number): { state: ProbState; prob: number }[] {
  const next: { state: ProbState; prob: number }[] = [];
  for (const out of enumerateDraw(state, draw)) {
    const drawn = Math.min(draw, state.deck);
    const unseenDeck = state.unseenDeck.map((x, i) => x - out.unseenDrawn[i]);
    const seenDeck = state.seenDeck.map((x, i) => x - out.seenDrawn[i]);
    const seenHand = state.seenHand.map((x, i) => x + out.unseenDrawn[i] + out.seenDrawn[i]);
    const hits = state.hits.map((x, i) => x + out.unseenDrawn[i]);
    next.push({
      state: {
        ...state,
        deck: Math.max(0, state.deck - drawn),
        hand: state.hand + drawn,
        unseenDeck,
        seenDeck,
        seenHand,
        hits,
      },
      prob: out.prob,
    });
  }
  return next;
}

function applyStep(state: ProbState, effect: CardEffect, compress?: number): { state: ProbState; prob: number }[] {
  if (effect.mode === "compress") {
    const c = compress ?? effect.compress;
    const totalTargetDeck = state.unseenDeck.reduce((a, b) => a + b, 0) + state.seenDeck.reduce((a, b) => a + b, 0);
    const removableOther = Math.max(0, state.deck - totalTargetDeck);
    const remove = Math.min(c, removableOther);
    return [{ state: { ...state, deck: state.deck - remove }, prob: 1 }];
  }

  if (effect.mode === "shuffle") {
    const base = {
      ...state,
      deck: state.deck + state.hand,
      hand: 0,
      seenDeck: state.seenDeck.map((x, i) => x + state.seenHand[i]),
      seenHand: state.seenHand.map(() => 0),
    };
    return applyDraw(base, effect.draw).map(({ state: s, prob }) => ({
      state: { ...s, hand: Math.min(effect.draw, base.deck) },
      prob,
    }));
  }

  if (effect.mode === "bottom") {
    const base = { ...state, hand: 0, seenHand: state.seenHand.map(() => 0) };
    const oldHand = state.hand;
    const oldSeenHand = state.seenHand;
    return applyDraw(base, effect.draw).map(({ state: s, prob }) => ({
      state: {
        ...s,
        deck: s.deck + oldHand,
        hand: Math.min(effect.draw, base.deck),
        seenDeck: s.seenDeck.map((x, i) => x + oldSeenHand[i]),
      },
      prob,
    }));
  }

  if (effect.mode === "discard") {
    // Discard hand to trash (not back to deck), then draw N
    const base = { ...state, hand: 0, seenHand: state.seenHand.map(() => 0) };
    return applyDraw(base, effect.draw).map(({ state: s, prob }) => ({
      state: { ...s, hand: Math.min(effect.draw, base.deck) },
      prob,
    }));
  }

  // mode === "draw"
  return applyDraw(state, effect.draw);
}

export function calculateProbability(params: {
  deckSize: number;
  handSize: number;
  targetCounts: number[];
  steps: ProbStep[];
  effects: CardEffect[];
  condition?: "any" | "all" | "atLeast";
  minHits?: number;
}): number {
  const { deckSize, handSize, targetCounts, steps, effects, condition = "any", minHits = 1 } = params;
  const n = targetCounts.length;
  if (n === 0 || steps.length === 0) return 0;
  if (targetCounts.every((c) => c === 0)) return 0;

  let dist = new Map<string, { state: ProbState; prob: number }>();
  addDist(
    dist,
    {
      deck: deckSize,
      hand: handSize,
      unseenDeck: [...targetCounts],
      seenDeck: new Array(n).fill(0),
      seenHand: new Array(n).fill(0),
      hits: new Array(n).fill(0),
    },
    1
  );

  for (const step of steps) {
    const effect = effects.find((e) => e.key === step.effectKey);
    if (!effect) continue;
    const next = new Map<string, { state: ProbState; prob: number }>();
    for (const item of dist.values()) {
      for (const out of applyStep(item.state, effect, step.compress)) {
        addDist(next, out.state, item.prob * out.prob);
      }
    }
    dist = next;
  }

  let success = 0;
  for (const item of dist.values()) {
    const { hits } = item.state;
    const active = targetCounts.map((c, i) => (c > 0 ? i : -1)).filter((i) => i >= 0);
    if (active.length === 0) continue;
    let met = false;
    if (condition === "any") met = active.some((i) => hits[i] >= 1);
    else if (condition === "all") met = active.every((i) => hits[i] >= 1);
    else met = hits.reduce((a, b) => a + b, 0) >= minHits;
    if (met) success += item.prob;
  }
  return Math.max(0, Math.min(1, success));
}

export function formatPct(p: number): string {
  if (!Number.isFinite(p)) return "—";
  if (p <= 0) return "0%";
  if (p >= 0.9999 && p < 1) return "99.99%";
  if (p >= 1) return "100%";
  return `${(p * 100).toFixed(2)}%`;
}

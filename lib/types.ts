export type Zone = "deck" | "hand" | "prizes" | "trash" | "field";

export const ZONE_COLOR: Record<Zone, string> = {
  deck: "bg-blue-800 text-blue-200",
  hand: "bg-yellow-800 text-yellow-200",
  prizes: "bg-purple-800 text-purple-200",
  trash: "bg-gray-700 text-gray-300",
  field: "bg-green-800 text-green-200",
};

export interface DeckCard {
  id: string;
  name: string;
  imageUrl: string;
  totalCount: number;
  category: "pokemon" | "trainer" | "energy";
}

export type EffectMode = "draw" | "shuffle" | "bottom" | "compress" | "discard";

export interface CardEffect {
  key: string;
  label: string;
  short: string;
  mode: EffectMode;
  draw: number;
  compress: number;
  description: string;
  imageUrl: string;
  builtin: boolean;
}

export interface ProbStep {
  id: number;
  effectKey: string;
  compress: number;
}

// Board-specific types
export type BoardZone =
  | "deck"
  | "hand"
  | "prizes"
  | "trash"
  | "battle"
  | "bench1"
  | "bench2"
  | "bench3"
  | "bench4"
  | "bench5";

export const BENCH_ZONES: BoardZone[] = ["bench1", "bench2", "bench3", "bench4", "bench5"];

export interface CardInstance {
  instanceId: string;
  cardId: string;
  faceDown: boolean;
}

export type BoardState = Record<BoardZone, CardInstance[]>;

export function emptyBoard(): BoardState {
  return {
    deck: [],
    hand: [],
    prizes: [],
    trash: [],
    battle: [],
    bench1: [],
    bench2: [],
    bench3: [],
    bench4: [],
    bench5: [],
  };
}

export function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

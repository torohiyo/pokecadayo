export type Zone = "deck" | "hand" | "prizes" | "trash" | "field";

export const ZONES: Zone[] = ["deck", "hand", "prizes", "trash", "field"];

export const ZONE_LABELS: Record<Zone, string> = {
  deck: "山札",
  hand: "手札",
  prizes: "サイド",
  trash: "トラッシュ",
  field: "場",
};

export const ZONE_SHORT: Record<Zone, string> = {
  deck: "山",
  hand: "手",
  prizes: "サ",
  trash: "ト",
  field: "場",
};

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

export type ZoneCounts = Record<Zone, number>;

export type GameState = Record<string, ZoneCounts>;

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

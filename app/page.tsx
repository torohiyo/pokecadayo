"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import { DeckCard, GameState, Zone, ZONE_SHORT, ZONE_COLOR, ProbStep } from "@/lib/types";
import { DEFAULT_EFFECTS } from "@/lib/effects";
import { calculateProbability, formatPct } from "@/lib/probability";

const NON_DECK_ZONES: Zone[] = ["hand", "prizes", "trash", "field"];

const CATEGORY_LABELS: Record<DeckCard["category"], string> = {
  pokemon: "ポケモン",
  trainer: "トレーナーズ",
  energy: "エネルギー",
};

const CATEGORY_ORDER: DeckCard["category"][] = ["pokemon", "trainer", "energy"];

function initGameState(cards: DeckCard[]): GameState {
  return Object.fromEntries(
    cards.map((c) => [c.id, { deck: c.totalCount, hand: 0, prizes: 0, trash: 0, field: 0 }])
  );
}

export default function Home() {
  const [deckCode, setDeckCode] = useState("");
  const [deckCards, setDeckCards] = useState<DeckCard[]>([]);
  const [gameState, setGameState] = useState<GameState>({});
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [steps, setSteps] = useState<ProbStep[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const stepIdRef = useRef(0);

  const loadDeck = useCallback(async () => {
    const code = deckCode.trim();
    if (!code) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/deck/${encodeURIComponent(code)}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setDeckCards(data.cards);
      setGameState(initGameState(data.cards));
      setTargetIds([]);
      setSteps([]);
      setExpandedId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, [deckCode]);

  const moveCard = useCallback((cardId: string, from: Zone, to: Zone) => {
    setGameState((prev) => {
      const z = prev[cardId];
      if (!z || z[from] <= 0) return prev;
      return { ...prev, [cardId]: { ...z, [from]: z[from] - 1, [to]: z[to] + 1 } };
    });
  }, []);

  const resetGameState = useCallback(() => {
    setGameState(initGameState(deckCards));
  }, [deckCards]);

  const toggleTarget = useCallback((cardId: string) => {
    setTargetIds((prev) => {
      if (prev.includes(cardId)) return prev.filter((id) => id !== cardId);
      if (prev.length >= 3) return [...prev.slice(1), cardId];
      return [...prev, cardId];
    });
  }, []);

  const addStep = useCallback((effectKey: string) => {
    const effect = DEFAULT_EFFECTS.find((e) => e.key === effectKey);
    if (!effect) return;
    setSteps((prev) => [
      ...prev,
      { id: ++stepIdRef.current, effectKey, compress: effect.compress },
    ]);
  }, []);

  const removeStep = useCallback((id: number) => {
    setSteps((prev) => prev.filter((s) => s.id !== id));
  }, []);

  const updateStepCompress = useCallback((id: number, compress: number) => {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, compress } : s)));
  }, []);

  const deckSize = useMemo(
    () => Object.values(gameState).reduce((sum, z) => sum + z.deck, 0),
    [gameState]
  );
  const handSize = useMemo(
    () => Object.values(gameState).reduce((sum, z) => sum + z.hand, 0),
    [gameState]
  );
  const prizesCount = useMemo(
    () => Object.values(gameState).reduce((sum, z) => sum + z.prizes, 0),
    [gameState]
  );
  const trashCount = useMemo(
    () => Object.values(gameState).reduce((sum, z) => sum + z.trash, 0),
    [gameState]
  );
  const targetCounts = useMemo(
    () => targetIds.map((id) => gameState[id]?.deck ?? 0),
    [targetIds, gameState]
  );

  const probability = useMemo(() => {
    if (steps.length === 0 || targetIds.length === 0) return null;
    return calculateProbability({ deckSize, handSize, targetCounts, steps, effects: DEFAULT_EFFECTS });
  }, [deckSize, handSize, targetCounts, steps]);

  const grouped = useMemo(() => {
    const g: Partial<Record<DeckCard["category"], DeckCard[]>> = {};
    for (const cat of CATEGORY_ORDER) {
      const cards = deckCards.filter((c) => c.category === cat);
      if (cards.length > 0) g[cat] = cards;
    }
    return g;
  }, [deckCards]);

  const totalCards = deckCards.reduce((s, c) => s + c.totalCount, 0);

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="bg-gray-900 border-b border-gray-800 px-4 py-3">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center gap-3">
          <h1 className="text-xl font-bold text-red-400 tracking-wide shrink-0">🃏 POKECADAYO</h1>
          <div className="flex gap-2 flex-1">
            <input
              type="text"
              value={deckCode}
              onChange={(e) => setDeckCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && loadDeck()}
              placeholder="デッキコードを入力 (例: XXXXXX)"
              className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm placeholder-gray-500 focus:outline-none focus:border-red-500"
            />
            <button
              onClick={loadDeck}
              disabled={loading || !deckCode.trim()}
              className="bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-4 py-2 rounded text-sm font-medium transition-colors"
            >
              {loading ? "読込中..." : "読み込む"}
            </button>
          </div>
        </div>
      </header>

      {error && (
        <div className="max-w-7xl mx-auto px-4 pt-3">
          <div className="bg-red-900/50 border border-red-700 rounded px-3 py-2 text-sm text-red-200">
            {error}
          </div>
        </div>
      )}

      {deckCards.length === 0 && !loading && (
        <div className="max-w-7xl mx-auto px-4 py-20 text-center text-gray-500">
          <p className="text-5xl mb-4">🃏</p>
          <p className="text-lg font-medium">デッキコードを入力してデッキを読み込もう</p>
          <p className="text-sm mt-2">pokemon-card.com のデッキコードに対応しています</p>
        </div>
      )}

      {deckCards.length > 0 && (
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col lg:flex-row gap-4">
          {/* Left: Deck list */}
          <div className="lg:w-3/5 min-w-0">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-300 text-sm">
                デッキ <span className="text-gray-500">({totalCards}枚)</span>
              </h2>
              <button
                onClick={resetGameState}
                className="text-xs text-gray-500 hover:text-gray-300 border border-gray-800 hover:border-gray-600 rounded px-2 py-1 transition-colors"
              >
                ゲームリセット
              </button>
            </div>

            {CATEGORY_ORDER.map((cat) => {
              const cards = grouped[cat];
              if (!cards) return null;
              const catTotal = cards.reduce((s, c) => s + c.totalCount, 0);
              return (
                <div key={cat} className="mb-5">
                  <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    {CATEGORY_LABELS[cat]} — {catTotal}枚
                  </div>
                  <div className="space-y-1">
                    {cards.map((card) => (
                      <CardRow
                        key={card.id}
                        card={card}
                        zones={gameState[card.id] ?? { deck: 0, hand: 0, prizes: 0, trash: 0, field: 0 }}
                        isTarget={targetIds.includes(card.id)}
                        targetIndex={targetIds.indexOf(card.id)}
                        expanded={expandedId === card.id}
                        onToggleExpand={() => setExpandedId((prev) => (prev === card.id ? null : card.id))}
                        onToggleTarget={() => toggleTarget(card.id)}
                        onMove={moveCard}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Right: Probability panel */}
          <div className="lg:w-2/5 min-w-0">
            <div className="lg:sticky lg:top-4 space-y-3">
              {/* Zone stats */}
              <div className="bg-gray-900 rounded-lg px-4 py-3">
                <div className="grid grid-cols-4 gap-2 text-center">
                  {[
                    { label: "山札", value: deckSize, color: "text-blue-400" },
                    { label: "手札", value: handSize, color: "text-yellow-400" },
                    { label: "サイド", value: prizesCount, color: "text-purple-400" },
                    { label: "トラッシュ", value: trashCount, color: "text-gray-400" },
                  ].map(({ label, value, color }) => (
                    <div key={label}>
                      <div className={`text-2xl font-bold tabular-nums ${color}`}>{value}</div>
                      <div className="text-xs text-gray-600">{label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Target cards */}
              <div className="bg-gray-900 rounded-lg p-4">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                  ターゲット <span className="text-gray-600 normal-case">(最大3枚)</span>
                </div>
                {targetIds.length === 0 ? (
                  <p className="text-xs text-gray-600 italic">
                    左のカードリストの ☆ を押して引きたいカードを選択
                  </p>
                ) : (
                  <div className="space-y-2">
                    {targetIds.map((id, i) => {
                      const card = deckCards.find((c) => c.id === id);
                      if (!card) return null;
                      const inDeck = gameState[id]?.deck ?? 0;
                      return (
                        <div key={id} className="flex items-center gap-2">
                          <span className="text-xs font-bold text-yellow-500 w-4">
                            {String.fromCharCode(65 + i)}
                          </span>
                          {card.imageUrl && (
                            <img
                              src={card.imageUrl}
                              alt={card.name}
                              className="w-8 h-10 object-cover rounded shrink-0"
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-xs truncate">{card.name}</div>
                            <div className="text-xs text-blue-400">山 {inDeck}枚</div>
                          </div>
                          <button
                            onClick={() => toggleTarget(id)}
                            className="text-gray-600 hover:text-red-400 text-sm transition-colors shrink-0"
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Effects rail */}
              <div className="bg-gray-900 rounded-lg p-4">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
                  カード効果
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                  {DEFAULT_EFFECTS.map((effect) => (
                    <button
                      key={effect.key}
                      onClick={() => addStep(effect.key)}
                      title={`${effect.label}\n${effect.description}`}
                      className="shrink-0 w-12 h-16 rounded overflow-hidden border-2 border-transparent hover:border-red-500 active:scale-95 transition-all"
                    >
                      {effect.imageUrl ? (
                        <img
                          src={effect.imageUrl}
                          alt={effect.label}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-gray-700 flex items-center justify-center text-xs text-gray-400">
                          {effect.short}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Steps */}
              {steps.length > 0 && (
                <div className="bg-gray-900 rounded-lg p-4">
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                      手順 ({steps.length})
                    </div>
                    <button
                      onClick={() => setSteps([])}
                      className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
                    >
                      クリア
                    </button>
                  </div>
                  <div className="space-y-2">
                    {steps.map((step, i) => {
                      const effect = DEFAULT_EFFECTS.find((e) => e.key === step.effectKey);
                      if (!effect) return null;
                      return (
                        <div key={step.id} className="flex items-center gap-2">
                          <span className="text-xs text-gray-600 w-4 shrink-0">{i + 1}</span>
                          {effect.imageUrl && (
                            <img
                              src={effect.imageUrl}
                              alt={effect.label}
                              className="w-7 h-9 object-cover rounded shrink-0"
                            />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="text-xs truncate">{effect.label}</div>
                            {effect.mode === "compress" && (
                              <div className="flex items-center gap-1 mt-0.5">
                                <span className="text-xs text-gray-500">圧縮枚数:</span>
                                <input
                                  type="number"
                                  min={0}
                                  max={30}
                                  value={step.compress}
                                  onChange={(e) =>
                                    updateStepCompress(
                                      step.id,
                                      Math.max(0, Math.min(30, parseInt(e.target.value || "0")))
                                    )
                                  }
                                  className="w-12 bg-gray-800 border border-gray-700 rounded px-1 text-xs"
                                />
                              </div>
                            )}
                          </div>
                          <button
                            onClick={() => removeStep(step.id)}
                            className="text-gray-600 hover:text-red-400 text-sm transition-colors shrink-0"
                          >
                            ×
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Result */}
              {steps.length > 0 && (
                <div className="bg-gray-900 rounded-lg p-4 text-center">
                  {targetIds.length === 0 ? (
                    <p className="text-sm text-gray-600">ターゲットカードを選択してください</p>
                  ) : (
                    <>
                      <div
                        className={`text-6xl font-bold tabular-nums py-2 ${
                          probability === null
                            ? "text-gray-600"
                            : probability >= 0.8
                            ? "text-green-400"
                            : probability >= 0.5
                            ? "text-yellow-400"
                            : "text-red-400"
                        }`}
                      >
                        {probability === null ? "—" : formatPct(probability)}
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        {steps.length}手順後・{targetIds.map((id) => deckCards.find((c) => c.id === id)?.name ?? "").join(" / ")} を1枚以上引ける確率
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface CardRowProps {
  card: DeckCard;
  zones: Record<Zone, number>;
  isTarget: boolean;
  targetIndex: number;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleTarget: () => void;
  onMove: (cardId: string, from: Zone, to: Zone) => void;
}

function CardRow({
  card,
  zones,
  isTarget,
  targetIndex,
  expanded,
  onToggleExpand,
  onToggleTarget,
  onMove,
}: CardRowProps) {
  const activeNonDeck = NON_DECK_ZONES.filter((z) => zones[z] > 0);

  return (
    <div
      className={`rounded-lg overflow-hidden transition-colors ${
        expanded ? "bg-gray-800" : "bg-gray-900 hover:bg-gray-800/70"
      }`}
    >
      <div
        className="flex items-center gap-2 px-3 py-2 cursor-pointer select-none"
        onClick={onToggleExpand}
      >
        <div className="shrink-0 w-9 h-12 rounded overflow-hidden bg-gray-800">
          {card.imageUrl ? (
            <img src={card.imageUrl} alt={card.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-600 text-xs">?</div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-sm truncate leading-tight">{card.name}</div>
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${ZONE_COLOR.deck}`}>
              山:{zones.deck}
            </span>
            {activeNonDeck.map((z) => (
              <span key={z} className={`text-xs px-1.5 py-0.5 rounded ${ZONE_COLOR[z]}`}>
                {ZONE_SHORT[z]}:{zones[z]}
              </span>
            ))}
          </div>
        </div>

        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleTarget();
          }}
          className={`shrink-0 w-7 h-7 flex items-center justify-center rounded transition-colors text-sm ${
            isTarget
              ? "bg-yellow-500 text-black font-bold"
              : "text-gray-600 hover:text-yellow-400"
          }`}
          title={isTarget ? "ターゲット解除" : "ターゲットに追加"}
        >
          {isTarget ? String.fromCharCode(65 + targetIndex) : "☆"}
        </button>
      </div>

      {expanded && (
        <div
          className="px-3 pb-3 border-t border-gray-700 pt-2"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="grid grid-cols-2 gap-2">
            {NON_DECK_ZONES.map((zone) => (
              <div
                key={zone}
                className="flex items-center justify-between bg-gray-950 rounded px-2 py-1.5"
              >
                <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${ZONE_COLOR[zone]}`}>
                  {ZONE_SHORT[zone]}
                </span>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => onMove(card.id, zone, "deck")}
                    disabled={zones[zone] <= 0}
                    className="w-6 h-6 flex items-center justify-center bg-gray-700 hover:bg-gray-600 disabled:opacity-25 disabled:cursor-not-allowed rounded text-sm leading-none transition-colors"
                  >
                    −
                  </button>
                  <span className="w-5 text-center text-sm tabular-nums">{zones[zone]}</span>
                  <button
                    onClick={() => onMove(card.id, "deck", zone)}
                    disabled={zones.deck <= 0}
                    className="w-6 h-6 flex items-center justify-center bg-gray-700 hover:bg-gray-600 disabled:opacity-25 disabled:cursor-not-allowed rounded text-sm leading-none transition-colors"
                  >
                    ＋
                  </button>
                </div>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-700 mt-2 text-center">
            ＋ デッキから移動 / − 山札へ戻す
          </p>
        </div>
      )}
    </div>
  );
}

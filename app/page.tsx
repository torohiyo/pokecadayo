"use client";

import { useState, useCallback, useMemo, useRef } from "react";
import {
  DeckCard,
  BoardZone,
  BoardState,
  CardInstance,
  BENCH_ZONES,
  emptyBoard,
  shuffleArray,
  ProbStep,
} from "@/lib/types";
import { DEFAULT_EFFECTS } from "@/lib/effects";
import { calculateProbability, formatPct } from "@/lib/probability";

// ─── helpers ─────────────────────────────────────────────

function createInstances(cards: DeckCard[]): CardInstance[] {
  let idx = 0;
  return cards.flatMap((c) =>
    Array.from({ length: c.totalCount }, () => ({
      instanceId: `${c.id}_${idx++}`,
      cardId: c.id,
      faceDown: true,
    }))
  );
}

// Face-down card visual
function CardBack({ size }: { size: "sm" | "md" | "lg" }) {
  const dim = size === "sm" ? "w-[52px] h-[72px]" : size === "lg" ? "w-[80px] h-[112px]" : "w-[64px] h-[90px]";
  return (
    <div className={`${dim} rounded-lg bg-gradient-to-br from-red-700 to-red-900 border-2 border-yellow-500 flex items-center justify-center shrink-0`}>
      <div className="w-4/5 h-4/5 border border-yellow-400/60 rounded flex items-center justify-center">
        <span className="text-yellow-400 text-base select-none">◆</span>
      </div>
    </div>
  );
}

// ─── Card component ───────────────────────────────────────

interface CardProps {
  card: CardInstance;
  cardMap: Map<string, DeckCard>;
  zone: BoardZone;
  size?: "sm" | "md" | "lg";
  isDragging?: boolean;
  onDragStart: (zone: BoardZone, instanceId: string) => void;
  onDragEnd: () => void;
}

function Card({ card, cardMap, zone, size = "md", isDragging, onDragStart, onDragEnd }: CardProps) {
  const deckCard = cardMap.get(card.cardId);
  const dim = size === "sm" ? "w-[52px] h-[72px]" : size === "lg" ? "w-[80px] h-[112px]" : "w-[64px] h-[90px]";

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart(zone, card.instanceId);
      }}
      onDragEnd={onDragEnd}
      className={`${dim} rounded-lg overflow-hidden cursor-grab active:cursor-grabbing shrink-0 transition-opacity select-none ${isDragging ? "opacity-30" : "hover:ring-2 hover:ring-yellow-400"}`}
    >
      {card.faceDown ? (
        <CardBack size={size} />
      ) : deckCard?.imageUrl ? (
        <img src={deckCard.imageUrl} alt={deckCard.name} className="w-full h-full object-cover" draggable={false} />
      ) : (
        <div className="w-full h-full bg-gray-700 flex items-center justify-center text-[10px] text-gray-400 p-1 text-center leading-tight">
          {deckCard?.name ?? "?"}
        </div>
      )}
    </div>
  );
}

// ─── Drop Zone wrapper ────────────────────────────────────

interface DropZoneProps {
  zone: BoardZone;
  activeZone: BoardZone | null;
  hasDragging: boolean;
  onDrop: (zone: BoardZone) => void;
  onDragOver: (zone: BoardZone) => void;
  onDragLeave: () => void;
  className?: string;
  children: React.ReactNode;
}

function DropZone({ zone, activeZone, hasDragging, onDrop, onDragOver, onDragLeave, className, children }: DropZoneProps) {
  const isOver = activeZone === zone && hasDragging;
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); onDragOver(zone); }}
      onDragLeave={onDragLeave}
      onDrop={() => onDrop(zone)}
      className={`${className ?? ""} ${isOver ? "ring-2 ring-yellow-400 ring-inset" : ""} transition-all`}
    >
      {children}
    </div>
  );
}

// ─── Empty slot placeholder ───────────────────────────────

function EmptySlot({ size, label }: { size: "sm" | "md" | "lg"; label?: string }) {
  const dim = size === "sm" ? "w-[52px] h-[72px]" : size === "lg" ? "w-[80px] h-[112px]" : "w-[64px] h-[90px]";
  return (
    <div className={`${dim} rounded-lg border-2 border-dashed border-white/20 flex items-center justify-center shrink-0`}>
      {label && <span className="text-white/20 text-[9px] text-center px-1">{label}</span>}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────

export default function Home() {
  const [deckCode, setDeckCode] = useState("");
  const [deckCards, setDeckCards] = useState<DeckCard[]>([]);
  const [board, setBoard] = useState<BoardState>(emptyBoard());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ zone: BoardZone; instanceId: string } | null>(null);
  const [dragOver, setDragOver] = useState<BoardZone | null>(null);

  // Probability panel
  const [probOpen, setProbOpen] = useState(false);
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [steps, setSteps] = useState<ProbStep[]>([]);
  const stepIdRef = useRef(0);

  const cardMap = useMemo(() => new Map(deckCards.map((c) => [c.id, c])), [deckCards]);

  // ── Load deck ────────────────────────────────────────────

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
      const instances = shuffleArray(createInstances(data.cards));
      const b = emptyBoard();
      b.deck = instances;
      setBoard(b);
      setTargetIds([]);
      setSteps([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, [deckCode]);

  // ── Setup: deal 7 hand, 6 prizes ─────────────────────────

  const setupGame = useCallback(() => {
    setBoard((prev) => {
      const all = Object.values(prev).flat();
      const shuffled = shuffleArray(all.map((c) => ({ ...c, faceDown: true })));
      const b = emptyBoard();
      b.prizes = shuffled.slice(0, 6);
      b.hand = shuffled.slice(6, 13).map((c) => ({ ...c, faceDown: false }));
      b.deck = shuffled.slice(13);
      return b;
    });
  }, []);

  // ── Draw one from deck ────────────────────────────────────

  const drawOne = useCallback(() => {
    setBoard((prev) => {
      if (prev.deck.length === 0) return prev;
      const top = { ...prev.deck[prev.deck.length - 1], faceDown: false };
      return { ...prev, deck: prev.deck.slice(0, -1), hand: [...prev.hand, top] };
    });
  }, []);

  // ── Drag & Drop ───────────────────────────────────────────

  const handleDragStart = useCallback((zone: BoardZone, instanceId: string) => {
    setDragging({ zone, instanceId });
  }, []);

  const handleDragEnd = useCallback(() => {
    setDragging(null);
    setDragOver(null);
  }, []);

  const handleDrop = useCallback(
    (targetZone: BoardZone) => {
      if (!dragging) return;
      setBoard((prev) => {
        const card = prev[dragging.zone].find((c) => c.instanceId === dragging.instanceId);
        if (!card) return prev;
        const faceDown =
          targetZone === "prizes" || targetZone === "deck"
            ? true
            : card.faceDown && targetZone === dragging.zone
            ? true
            : false;
        const updated = { ...card, faceDown };
        return {
          ...prev,
          [dragging.zone]: prev[dragging.zone].filter((c) => c.instanceId !== dragging.instanceId),
          [targetZone]: [...prev[targetZone], updated],
        };
      });
      setDragging(null);
      setDragOver(null);
    },
    [dragging]
  );

  const dropProps = (zone: BoardZone) => ({
    zone,
    activeZone: dragOver,
    hasDragging: !!dragging,
    onDrop: handleDrop,
    onDragOver: (z: BoardZone) => setDragOver(z),
    onDragLeave: () => setDragOver(null),
  });

  const cardProps = (zone: BoardZone) => ({
    zone,
    cardMap,
    onDragStart: handleDragStart,
    onDragEnd: handleDragEnd,
  });

  // ── Probability ───────────────────────────────────────────

  const deckSize = board.deck.length;
  const handSize = board.hand.length;
  const targetCounts = useMemo(
    () => targetIds.map((id) => board.deck.filter((c) => c.cardId === id).length),
    [targetIds, board.deck]
  );
  const probability = useMemo(() => {
    if (steps.length === 0 || targetIds.length === 0) return null;
    return calculateProbability({ deckSize, handSize, targetCounts, steps, effects: DEFAULT_EFFECTS });
  }, [deckSize, handSize, targetCounts, steps]);

  const isGameSetup = board.hand.length > 0 || board.prizes.length > 0;

  return (
    <div className="min-h-screen bg-[#0d3b1e] text-white flex flex-col overflow-hidden">
      {/* ── Header ── */}
      <header className="bg-black/40 px-3 py-2 flex items-center gap-2 shrink-0 border-b border-white/10">
        <span className="font-bold text-yellow-400 text-sm tracking-wide shrink-0">🃏 POKECADAYO</span>
        <input
          type="text"
          value={deckCode}
          onChange={(e) => setDeckCode(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && loadDeck()}
          placeholder="デッキコード"
          className="bg-black/40 border border-white/20 rounded px-2 py-1 text-xs w-36 placeholder-white/30 focus:outline-none focus:border-yellow-400"
        />
        <button
          onClick={loadDeck}
          disabled={loading || !deckCode.trim()}
          className="bg-yellow-500 hover:bg-yellow-400 disabled:opacity-40 text-black text-xs font-bold px-3 py-1 rounded transition-colors shrink-0"
        >
          {loading ? "..." : "読込"}
        </button>
        {deckCards.length > 0 && (
          <button
            onClick={setupGame}
            className="bg-green-500 hover:bg-green-400 text-black text-xs font-bold px-3 py-1 rounded transition-colors shrink-0"
          >
            {isGameSetup ? "再セット" : "セット"}
          </button>
        )}
        {error && <span className="text-red-400 text-xs truncate">{error}</span>}
        <div className="flex-1" />
        <button
          onClick={() => setProbOpen((p) => !p)}
          className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold px-3 py-1 rounded transition-colors shrink-0"
        >
          確率計算
        </button>
      </header>

      {/* ── Board ── */}
      <div className="flex-1 p-2 flex flex-col gap-2 min-h-0">

        {/* Row 1: prizes + battle + stadium/vstar */}
        <div className="flex gap-2 items-stretch">

          {/* Prizes: 2×3 grid */}
          <DropZone {...dropProps("prizes")} className="bg-black/30 rounded-xl border border-white/10 p-2 shrink-0">
            <div className="text-[10px] text-white/40 text-center mb-1">サイド ({board.prizes.length})</div>
            <div className="grid grid-cols-2 gap-1">
              {Array.from({ length: 6 }).map((_, i) => {
                const c = board.prizes[i];
                return c ? (
                  <Card key={c.instanceId} card={c} size="sm" isDragging={dragging?.instanceId === c.instanceId} {...cardProps("prizes")} />
                ) : (
                  <EmptySlot key={i} size="sm" />
                );
              })}
            </div>
          </DropZone>

          {/* Battle zone */}
          <DropZone {...dropProps("battle")} className="flex-1 bg-black/30 rounded-xl border border-white/10 p-3 flex flex-col items-center justify-center min-h-[140px]">
            <div className="text-[10px] text-white/40 mb-2">バトル場</div>
            <div className="flex gap-1 flex-wrap justify-center">
              {board.battle.length > 0 ? (
                board.battle.map((c) => (
                  <Card key={c.instanceId} card={c} size="lg" isDragging={dragging?.instanceId === c.instanceId} {...cardProps("battle")} />
                ))
              ) : (
                <EmptySlot size="lg" label="ドロップ" />
              )}
            </div>
          </DropZone>

          {/* Right column: stadium + vstar */}
          <div className="flex flex-col gap-2 shrink-0">
            <div className="bg-black/30 rounded-xl border border-white/10 p-2 w-[80px] h-[88px] flex flex-col items-center justify-center">
              <div className="text-[9px] text-white/30 mb-1">スタジアム</div>
              <EmptySlot size="sm" />
            </div>
            <div className="bg-yellow-900/40 rounded-xl border border-yellow-600/40 p-2 w-[80px] flex items-center justify-center">
              <span className="font-black text-yellow-400 text-sm tracking-wider">VSTAR</span>
            </div>
          </div>
        </div>

        {/* Row 2: Bench */}
        <div className="flex gap-1.5">
          {BENCH_ZONES.map((zone, i) => (
            <DropZone key={zone} {...dropProps(zone)} className="flex-1 bg-black/30 rounded-xl border border-white/10 p-1.5 flex flex-col items-center min-w-0">
              <div className="text-[9px] text-white/30 mb-1">ベンチ{i + 1}</div>
              <div className="flex flex-col gap-0.5 items-center">
                {board[zone].length > 0 ? (
                  board[zone].map((c) => (
                    <Card key={c.instanceId} card={c} size="sm" isDragging={dragging?.instanceId === c.instanceId} {...cardProps(zone)} />
                  ))
                ) : (
                  <EmptySlot size="sm" />
                )}
              </div>
            </DropZone>
          ))}
        </div>

        {/* Row 3: hand + trash + deck */}
        <div className="flex gap-2 items-end">

          {/* Hand */}
          <DropZone {...dropProps("hand")} className="flex-1 bg-black/30 rounded-xl border border-white/10 p-2 min-w-0">
            <div className="text-[10px] text-white/40 mb-1.5">手札 ({board.hand.length})</div>
            <div className="flex gap-1 overflow-x-auto pb-1" style={{ minHeight: 90 }}>
              {board.hand.length > 0 ? (
                board.hand.map((c) => (
                  <Card key={c.instanceId} card={c} size="md" isDragging={dragging?.instanceId === c.instanceId} {...cardProps("hand")} />
                ))
              ) : (
                <div className="text-white/20 text-xs self-center px-2">
                  {deckCards.length === 0 ? "デッキコードを入力してください" : "「セット」で7枚ドロー"}
                </div>
              )}
            </div>
          </DropZone>

          {/* Trash */}
          <DropZone {...dropProps("trash")} className="bg-black/30 rounded-xl border border-white/10 p-2 w-[76px] flex flex-col items-center shrink-0">
            <div className="text-[10px] text-white/40 mb-1">トラッシュ</div>
            <div className="text-[10px] text-white/30 mb-1">({board.trash.length})</div>
            {board.trash.length > 0 ? (
              <Card card={board.trash[board.trash.length - 1]} size="sm" isDragging={dragging?.instanceId === board.trash[board.trash.length - 1].instanceId} {...cardProps("trash")} />
            ) : (
              <EmptySlot size="sm" />
            )}
          </DropZone>

          {/* Deck */}
          <div className="bg-black/30 rounded-xl border border-white/10 p-2 w-[76px] flex flex-col items-center shrink-0">
            <div className="text-[10px] text-white/40 mb-1">山札</div>
            <div className="text-[10px] text-white/30 mb-1">({board.deck.length})</div>
            <DropZone {...dropProps("deck")} className="cursor-pointer">
              {board.deck.length > 0 ? (
                <div onClick={drawOne} title="クリックで1枚ドロー">
                  <CardBack size="sm" />
                </div>
              ) : (
                <EmptySlot size="sm" />
              )}
            </DropZone>
            <button
              onClick={drawOne}
              disabled={board.deck.length === 0}
              className="mt-1.5 text-[10px] text-yellow-400/80 hover:text-yellow-300 disabled:opacity-30 transition-colors"
            >
              1枚ドロー
            </button>
          </div>
        </div>
      </div>

      {/* ── Probability Drawer ── */}
      {probOpen && (
        <>
          <div className="fixed inset-0 bg-black/40 z-40" onClick={() => setProbOpen(false)} />
          <aside className="fixed right-0 top-0 h-full w-72 bg-gray-950 border-l border-gray-800 shadow-2xl z-50 flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800 shrink-0">
              <span className="font-bold text-sm">確率計算</span>
              <button onClick={() => setProbOpen(false)} className="text-gray-500 hover:text-white text-xl leading-none">×</button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-4">
              {/* Stats */}
              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="bg-gray-900 rounded-lg py-2">
                  <div className="text-3xl font-bold text-blue-400 tabular-nums">{deckSize}</div>
                  <div className="text-xs text-gray-500">山札</div>
                </div>
                <div className="bg-gray-900 rounded-lg py-2">
                  <div className="text-3xl font-bold text-yellow-400 tabular-nums">{handSize}</div>
                  <div className="text-xs text-gray-500">手札</div>
                </div>
              </div>

              {/* Targets */}
              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">ターゲット</div>
                {targetIds.length > 0 && (
                  <div className="space-y-1.5 mb-2">
                    {targetIds.map((id, i) => {
                      const card = deckCards.find((c) => c.id === id);
                      const inDeck = board.deck.filter((c) => c.cardId === id).length;
                      return (
                        <div key={id} className="flex items-center gap-2 bg-gray-900 rounded px-2 py-1">
                          <span className="text-xs font-bold text-yellow-500 w-4">{String.fromCharCode(65 + i)}</span>
                          {card?.imageUrl && <img src={card.imageUrl} className="w-6 h-8 object-cover rounded" />}
                          <div className="flex-1 min-w-0">
                            <div className="text-xs truncate">{card?.name}</div>
                            <div className="text-xs text-blue-400">山 {inDeck}枚</div>
                          </div>
                          <button onClick={() => setTargetIds((p) => p.filter((x) => x !== id))} className="text-gray-600 hover:text-red-400 text-sm">×</button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="text-xs text-gray-500 mb-1">デッキから選択:</div>
                <div className="max-h-36 overflow-y-auto space-y-0.5">
                  {deckCards.map((card) => {
                    const inDeck = board.deck.filter((c) => c.cardId === card.id).length;
                    const isTarget = targetIds.includes(card.id);
                    return (
                      <button
                        key={card.id}
                        onClick={() =>
                          setTargetIds((prev) => {
                            if (prev.includes(card.id)) return prev.filter((x) => x !== card.id);
                            if (prev.length >= 3) return [...prev.slice(1), card.id];
                            return [...prev, card.id];
                          })
                        }
                        className={`w-full flex items-center gap-2 px-2 py-1 rounded text-xs transition-colors ${isTarget ? "bg-yellow-900/50 border border-yellow-700" : "hover:bg-gray-800"}`}
                      >
                        {card.imageUrl && <img src={card.imageUrl} className="w-5 h-7 object-cover rounded shrink-0" />}
                        <span className="flex-1 text-left truncate">{card.name}</span>
                        <span className={inDeck > 0 ? "text-blue-400" : "text-gray-600"}>山:{inDeck}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Effects */}
              <div>
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">カード効果</div>
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {DEFAULT_EFFECTS.map((effect) => (
                    <button
                      key={effect.key}
                      onClick={() =>
                        setSteps((p) => [...p, { id: ++stepIdRef.current, effectKey: effect.key, compress: effect.compress }])
                      }
                      title={`${effect.label} — ${effect.description}`}
                      className="shrink-0 w-[44px] h-[60px] rounded overflow-hidden border-2 border-transparent hover:border-red-500 transition-colors"
                    >
                      {effect.imageUrl ? (
                        <img src={effect.imageUrl} alt={effect.label} className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full bg-gray-700 flex items-center justify-center text-[10px] text-gray-400">
                          {effect.short}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Steps */}
              {steps.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider">手順</div>
                    <button onClick={() => setSteps([])} className="text-xs text-gray-600 hover:text-gray-400">クリア</button>
                  </div>
                  <div className="space-y-1">
                    {steps.map((step, i) => {
                      const effect = DEFAULT_EFFECTS.find((e) => e.key === step.effectKey);
                      if (!effect) return null;
                      return (
                        <div key={step.id} className="flex items-center gap-1.5 text-xs">
                          <span className="text-gray-600 w-3 shrink-0">{i + 1}</span>
                          {effect.imageUrl && <img src={effect.imageUrl} className="w-6 h-8 object-cover rounded shrink-0" />}
                          <span className="flex-1 truncate">{effect.label}</span>
                          {effect.mode === "compress" && (
                            <input
                              type="number"
                              min={0}
                              max={30}
                              value={step.compress}
                              onChange={(e) =>
                                setSteps((p) =>
                                  p.map((s) => s.id === step.id ? { ...s, compress: Math.max(0, Math.min(30, parseInt(e.target.value || "0"))) } : s)
                                )
                              }
                              className="w-10 bg-gray-800 border border-gray-700 rounded px-1 text-xs"
                            />
                          )}
                          <button onClick={() => setSteps((p) => p.filter((s) => s.id !== step.id))} className="text-gray-600 hover:text-red-400 shrink-0">×</button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Result */}
              {steps.length > 0 && (
                <div className="bg-gray-900 rounded-xl p-4 text-center">
                  {targetIds.length === 0 ? (
                    <p className="text-sm text-gray-600">ターゲットを選択</p>
                  ) : (
                    <>
                      <div
                        className={`text-5xl font-bold tabular-nums ${
                          probability === null ? "text-gray-600"
                            : probability >= 0.8 ? "text-green-400"
                            : probability >= 0.5 ? "text-yellow-400"
                            : "text-red-400"
                        }`}
                      >
                        {probability === null ? "—" : formatPct(probability)}
                      </div>
                      <p className="text-xs text-gray-500 mt-1">
                        {steps.length}手順後に1枚以上引ける確率
                      </p>
                    </>
                  )}
                </div>
              )}
            </div>
          </aside>
        </>
      )}
    </div>
  );
}

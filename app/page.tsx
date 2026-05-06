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

// ─── helpers ─────────────────────────────────────────────────────────────────

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

// ─── card back ───────────────────────────────────────────────────────────────

const CARD_DIM: Record<"sm" | "md" | "lg", [number, number]> = {
  sm: [52, 72],
  md: [64, 90],
  lg: [80, 112],
};

function CardBack({ size }: { size: "sm" | "md" | "lg" }) {
  const [w, h] = CARD_DIM[size];
  return (
    <div
      style={{ width: w, height: h }}
      className="rounded-lg bg-gradient-to-br from-red-700 to-red-900 border-2 border-yellow-500 flex items-center justify-center shrink-0"
    >
      <div className="w-4/5 h-4/5 border border-yellow-400/60 rounded flex items-center justify-center">
        <span className="text-yellow-400 text-base select-none">◆</span>
      </div>
    </div>
  );
}

// ─── single Card ─────────────────────────────────────────────────────────────

interface CardProps {
  card: CardInstance;
  cardMap: Map<string, DeckCard>;
  zone: BoardZone;
  size?: "sm" | "md" | "lg";
  isDragging?: boolean;
  isSelected?: boolean;
  onDragStart: (zone: BoardZone, instanceId: string) => void;
  onDragEnd: () => void;
  onClick?: (instanceId: string, e: React.MouseEvent) => void;
}

function Card({ card, cardMap, zone, size = "md", isDragging, isSelected, onDragStart, onDragEnd, onClick }: CardProps) {
  const deckCard = cardMap.get(card.cardId);
  const [w, h] = CARD_DIM[size];

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        onDragStart(zone, card.instanceId);
      }}
      onDragEnd={onDragEnd}
      onClick={(e) => onClick?.(card.instanceId, e)}
      style={{ width: w, height: h }}
      className={`rounded-lg overflow-hidden cursor-grab active:cursor-grabbing shrink-0 transition-all select-none ${
        isSelected ? "ring-2 ring-blue-400 brightness-110" : isDragging ? "opacity-30" : "hover:ring-2 hover:ring-yellow-400"
      }`}
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

// ─── Fanned/stacked card pile ─────────────────────────────────────────────────
// cards[0] is the "main" card (front, rightmost).  cards[1..] are stacked behind (left).

const STACK_OFFSET = 22; // px per card in the fan

interface StackedProps extends Omit<CardProps, "card" | "isSelected"> {
  cards: CardInstance[];
  draggingId: string | null;
  selectedIds?: Set<string>;
}

function StackedCards({ cards, draggingId, selectedIds, size = "sm", ...rest }: StackedProps) {
  if (cards.length === 0) return null;
  const [w, h] = CARD_DIM[size];
  const totalW = w + (cards.length - 1) * STACK_OFFSET;

  // reversed so index-0 of reversed = last placed = leftmost behind
  const reversed = [...cards].reverse();

  return (
    <div className="relative shrink-0" style={{ width: totalW, height: h }}>
      {reversed.map((card, i) => (
        <div key={card.instanceId} style={{ position: "absolute", left: i * STACK_OFFSET, zIndex: i, top: 0 }}>
          <Card card={card} size={size} isDragging={draggingId === card.instanceId} isSelected={selectedIds?.has(card.instanceId)} {...rest} />
        </div>
      ))}
    </div>
  );
}

// ─── Drop Zone wrapper ────────────────────────────────────────────────────────

interface DropZoneProps {
  zone: BoardZone;
  activeZone: BoardZone | null;
  hasDragging: boolean;
  onDrop: (zone: BoardZone) => void;
  onDragOver: (zone: BoardZone) => void;
  onDragLeave: () => void;
  className?: string;
  style?: React.CSSProperties;
  children: React.ReactNode;
}

function DropZone({ zone, activeZone, hasDragging, onDrop, onDragOver, onDragLeave, className, style, children }: DropZoneProps) {
  const isOver = activeZone === zone && hasDragging;
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); onDragOver(zone); }}
      onDragLeave={onDragLeave}
      onDrop={() => onDrop(zone)}
      style={style}
      className={`${className ?? ""} ${isOver ? "ring-2 ring-yellow-400 ring-inset" : ""} transition-all`}
    >
      {children}
    </div>
  );
}

function EmptySlot({ size, label }: { size: "sm" | "md" | "lg"; label?: string }) {
  const [w, h] = CARD_DIM[size];
  return (
    <div
      style={{ width: w, height: h }}
      className="rounded-lg border-2 border-dashed border-white/20 flex items-center justify-center shrink-0"
    >
      {label && <span className="text-white/20 text-[9px] text-center px-1">{label}</span>}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function Home() {
  const [deckCode, setDeckCode] = useState("");
  const [deckCards, setDeckCards] = useState<DeckCard[]>([]);
  const [board, setBoard] = useState<BoardState>(emptyBoard());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<{ zone: BoardZone; instanceId: string } | null>(null);
  const [dragOver, setDragOver] = useState<BoardZone | null>(null);

  // deck viewer
  const [deckViewerOpen, setDeckViewerOpen] = useState(false);
  const [drawCount, setDrawCount] = useState(1);
  const [boardSelected, setBoardSelected] = useState<Set<string>>(new Set());

  // deck-viewer inline probability mode
  interface DvTarget { cardId: string; minCount: number; }
  const [dvProb, setDvProb] = useState<{ targets: DvTarget[]; steps: ProbStep[]; condition: "any" | "all" } | null>(null);

  // probability panel
  const [probOpen, setProbOpen] = useState(false);
  const [targetIds, setTargetIds] = useState<string[]>([]);
  const [steps, setSteps] = useState<ProbStep[]>([]);
  const stepIdRef = useRef(0);

  const cardMap = useMemo(() => new Map(deckCards.map((c) => [c.id, c])), [deckCards]);
  const deckOrderMap = useMemo(() => new Map(deckCards.map((c, i) => [c.id, i])), [deckCards]);

  // deck-viewer probability calculations
  const dvTargetCounts = useMemo(
    () => (dvProb?.targets ?? []).map((t) => board.deck.filter((c) => c.cardId === t.cardId).length),
    [dvProb?.targets, board.deck]
  );
  const dvMinCounts = useMemo(
    () => (dvProb?.targets ?? []).map((t) => t.minCount),
    [dvProb?.targets]
  );
  const dvProbability = useMemo(() => {
    if (!dvProb || dvProb.steps.length === 0 || dvProb.targets.length === 0) return null;
    return calculateProbability({
      deckSize: board.deck.length,
      handSize: board.hand.length,
      targetCounts: dvTargetCounts,
      steps: dvProb.steps,
      effects: DEFAULT_EFFECTS,
      condition: dvProb.condition,
      minCounts: dvMinCounts,
    });
  }, [dvProb, dvTargetCounts, dvMinCounts, board.deck.length, board.hand.length]);

  const handleDvDoubleClick = useCallback((cardId: string) => {
    setDvProb((prev) => {
      const base = prev ?? { targets: [], steps: [], condition: "any" as const };
      if (base.targets.some((t) => t.cardId === cardId)) {
        return { ...base, targets: base.targets.filter((t) => t.cardId !== cardId) };
      }
      const newTarget: DvTarget = { cardId, minCount: 1 };
      if (base.targets.length >= 3) {
        return { ...base, targets: [...base.targets.slice(1), newTarget] };
      }
      return { ...base, targets: [...base.targets, newTarget] };
    });
  }, []);

  const setDvTargetMinCount = useCallback((cardId: string, minCount: number) => {
    setDvProb((prev) => {
      if (!prev) return prev;
      return { ...prev, targets: prev.targets.map((t) => t.cardId === cardId ? { ...t, minCount } : t) };
    });
  }, []);

  const addDvStep = useCallback((effectKey: string) => {
    const effect = DEFAULT_EFFECTS.find((e) => e.key === effectKey);
    if (!effect) return;
    setDvProb((prev) => {
      if (!prev) return prev;
      return { ...prev, steps: [...prev.steps, { id: ++stepIdRef.current, effectKey, compress: effect.compress }] };
    });
  }, []);

  const boardMoveSelected = useCallback((action: "trash" | "shuffle" | "top" | "bottom") => {
    setBoard((prev) => {
      if (boardSelected.size === 0) return prev;
      // Collect selected cards from all non-deck zones
      const allZones: (keyof typeof prev)[] = ["hand", "prizes", "trash", "battle", "bench1", "bench2", "bench3", "bench4", "bench5"];
      const selected: CardInstance[] = [];
      const next = { ...prev };
      for (const zone of allZones) {
        const z = zone as BoardZone;
        const kept = prev[z].filter((c) => !boardSelected.has(c.instanceId));
        const taken = prev[z].filter((c) => boardSelected.has(c.instanceId));
        next[z] = kept;
        selected.push(...taken);
      }
      switch (action) {
        case "trash":
          return { ...next, trash: [...next.trash, ...selected.map((c) => ({ ...c, faceDown: false }))] };
        case "shuffle": {
          const deck = shuffleArray([...next.deck, ...selected.map((c) => ({ ...c, faceDown: true }))]);
          return { ...next, deck };
        }
        case "top": {
          const toPlace = selected.length > 1 ? shuffleArray(selected) : selected;
          return { ...next, deck: [...next.deck, ...toPlace.map((c) => ({ ...c, faceDown: true }))] };
        }
        case "bottom": {
          const toPlace = selected.length > 1 ? shuffleArray(selected) : selected;
          return { ...next, deck: [...toPlace.map((c) => ({ ...c, faceDown: true })), ...next.deck] };
        }
        default:
          return prev;
      }
    });
    setBoardSelected(new Set());
  }, [boardSelected]);

  const handleBoardCardClick = useCallback((instanceId: string, e: React.MouseEvent) => {
    setBoardSelected((prev) => {
      const next = new Set(prev);
      if (e.shiftKey) {
        if (next.has(instanceId)) next.delete(instanceId);
        else next.add(instanceId);
      } else {
        if (next.has(instanceId) && next.size === 1) next.clear();
        else { next.clear(); next.add(instanceId); }
      }
      return next;
    });
  }, []);

  // ── Prizes operations ────────────────────────────────────────────────────────

  const flipAllPrizes = useCallback(() => {
    setBoard((prev) => ({ ...prev, prizes: prev.prizes.map((c) => ({ ...c, faceDown: false })) }));
  }, []);

  const takePrizes = useCallback((n: number) => {
    setBoard((prev) => {
      const count = Math.min(n, prev.prizes.length);
      if (count === 0) return prev;
      const taken = prev.prizes.slice(-count).map((c) => ({ ...c, faceDown: false }));
      return { ...prev, prizes: prev.prizes.slice(0, -count), hand: [...prev.hand, ...taken] };
    });
  }, []);

  const shufflePrizes = useCallback(() => {
    setBoard((prev) => ({ ...prev, prizes: shuffleArray(prev.prizes) }));
  }, []);

  // ── Hand draw effects (real actions) ─────────────────────────────────────────

  const performHandEffect = useCallback((effectKey: string) => {
    setBoard((prev) => {
      const { deck, hand, trash } = prev;
      switch (effectKey) {
        case "hakase": {
          const n = Math.min(7, deck.length);
          return { ...prev, trash: [...trash, ...hand.map((c) => ({ ...c, faceDown: false }))], hand: deck.slice(-n).map((c) => ({ ...c, faceDown: false })), deck: deck.slice(0, -n) };
        }
        case "lillie_strong": {
          const nd = shuffleArray([...deck, ...hand.map((c) => ({ ...c, faceDown: true }))]);
          const n = Math.min(8, nd.length);
          return { ...prev, deck: nd.slice(0, -n), hand: nd.slice(-n).map((c) => ({ ...c, faceDown: false })) };
        }
        case "lillie_weak": {
          const nd = shuffleArray([...deck, ...hand.map((c) => ({ ...c, faceDown: true }))]);
          const n = Math.min(6, nd.length);
          return { ...prev, deck: nd.slice(0, -n), hand: nd.slice(-n).map((c) => ({ ...c, faceDown: false })) };
        }
        case "unfair5": {
          const nd = shuffleArray([...deck, ...hand.map((c) => ({ ...c, faceDown: true }))]);
          const n = Math.min(5, nd.length);
          return { ...prev, deck: nd.slice(0, -n), hand: nd.slice(-n).map((c) => ({ ...c, faceDown: false })) };
        }
        case "unfair2": {
          const nd = shuffleArray([...deck, ...hand.map((c) => ({ ...c, faceDown: true }))]);
          const n = Math.min(2, nd.length);
          return { ...prev, deck: nd.slice(0, -n), hand: nd.slice(-n).map((c) => ({ ...c, faceDown: false })) };
        }
        case "redcard": {
          // hand goes to bottom of deck, draw 3
          const nd = [...hand.map((c) => ({ ...c, faceDown: true })), ...deck];
          const n = Math.min(3, nd.length);
          return { ...prev, deck: nd.slice(0, -n), hand: nd.slice(-n).map((c) => ({ ...c, faceDown: false })) };
        }
        case "sakateni": {
          const n = Math.min(3, deck.length);
          return { ...prev, deck: deck.slice(0, -n), hand: [...hand, ...deck.slice(-n).map((c) => ({ ...c, faceDown: false }))] };
        }
        case "dash": {
          const n = Math.min(2, deck.length);
          return { ...prev, deck: deck.slice(0, -n), hand: [...hand, ...deck.slice(-n).map((c) => ({ ...c, faceDown: false }))] };
        }
        case "midori": {
          const n = Math.min(1, deck.length);
          return { ...prev, deck: deck.slice(0, -n), hand: [...hand, ...deck.slice(-n).map((c) => ({ ...c, faceDown: false }))] };
        }
        default:
          return prev;
      }
    });
  }, []);

  // ── Load ────────────────────────────────────────────────────────────────────

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
      setBoardSelected(new Set());
      setDeckViewerOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み込みに失敗しました");
    } finally {
      setLoading(false);
    }
  }, [deckCode]);

  // ── Setup ───────────────────────────────────────────────────────────────────

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
    setDeckViewerOpen(false);
    setBoardSelected(new Set());
  }, []);

  // ── Deck operations ─────────────────────────────────────────────────────────

  const drawOne = useCallback(() => {
    setBoard((prev) => {
      if (prev.deck.length === 0) return prev;
      const top = { ...prev.deck[prev.deck.length - 1], faceDown: false };
      return { ...prev, deck: prev.deck.slice(0, -1), hand: [...prev.hand, top] };
    });
  }, []);

  const drawN = useCallback(() => {
    setBoard((prev) => {
      const n = Math.min(drawCount, prev.deck.length);
      if (n <= 0) return prev;
      const drawn = prev.deck.slice(-n).map((c) => ({ ...c, faceDown: false }));
      return { ...prev, deck: prev.deck.slice(0, -n), hand: [...prev.hand, ...drawn] };
    });
  }, [drawCount]);

  const shuffleDeck = useCallback(() => {
    setBoard((prev) => ({ ...prev, deck: shuffleArray(prev.deck) }));
  }, []);

  const sortZone = useCallback(
    (zone: BoardZone) => {
      setBoard((prev) => ({
        ...prev,
        [zone]: [...prev[zone]].sort(
          (a, b) => (deckOrderMap.get(a.cardId) ?? 999) - (deckOrderMap.get(b.cardId) ?? 999)
        ),
      }));
    },
    [deckOrderMap]
  );

  // ── Drag & Drop ─────────────────────────────────────────────────────────────

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
        const faceDown = targetZone === "prizes" || targetZone === "deck";
        return {
          ...prev,
          [dragging.zone]: prev[dragging.zone].filter((c) => c.instanceId !== dragging.instanceId),
          [targetZone]: [...prev[targetZone], { ...card, faceDown }],
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

  const sharedCardProps = {
    cardMap,
    onDragStart: handleDragStart,
    onDragEnd: handleDragEnd,
  };

  // ── Probability ──────────────────────────────────────────────────────────────

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
    <div className="bg-[#0d3b1e] text-white flex flex-col" style={{ minHeight: "100dvh" }}>

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
      <div className="flex-1 p-2 flex flex-col gap-2">

        {/* Row 1: prizes + battle + stadium/vstar */}
        <div className="flex gap-2 items-stretch">

          {/* Prizes 2×3 */}
          <DropZone {...dropProps("prizes")} className="bg-black/30 rounded-xl border border-white/10 p-2 shrink-0 flex flex-col">
            <div className="text-[10px] text-white/40 text-center mb-1">サイド ({board.prizes.length})</div>
            <div className="grid grid-cols-2 gap-1">
              {Array.from({ length: 6 }).map((_, i) => {
                const c = board.prizes[i];
                return c ? (
                  <Card key={c.instanceId} card={c} size="sm" isDragging={dragging?.instanceId === c.instanceId} isSelected={boardSelected.has(c.instanceId)} zone="prizes" onClick={handleBoardCardClick} {...sharedCardProps} />
                ) : (
                  <EmptySlot key={i} size="sm" />
                );
              })}
            </div>
            {board.prizes.length > 0 && (
              <div className="mt-2 flex flex-col gap-1">
                <button onClick={flipAllPrizes} className="w-full text-[9px] bg-white/10 hover:bg-white/20 rounded py-1 transition-colors">全表にする</button>
                <div className="flex gap-1">
                  {[1, 2, 3].map((n) => (
                    <button key={n} onClick={() => takePrizes(n)} disabled={board.prizes.length < n} className="flex-1 text-[9px] bg-white/10 hover:bg-white/20 disabled:opacity-30 rounded py-1 transition-colors">{n}枚取る</button>
                  ))}
                </div>
                <button onClick={shufflePrizes} className="w-full text-[9px] bg-white/10 hover:bg-white/20 rounded py-1 transition-colors">シャッフル</button>
              </div>
            )}
          </DropZone>

          {/* Battle */}
          <DropZone {...dropProps("battle")} className="flex-1 bg-black/30 rounded-xl border border-white/10 p-3 flex flex-col items-center justify-center" style={{ minHeight: 140 }}>
            <div className="text-[10px] text-white/40 mb-2">バトル場</div>
            {board.battle.length > 0 ? (
              <StackedCards cards={board.battle} draggingId={dragging?.instanceId ?? null} selectedIds={boardSelected} size="lg" zone="battle" onClick={handleBoardCardClick} {...sharedCardProps} />
            ) : (
              <EmptySlot size="lg" label="ドロップ" />
            )}
          </DropZone>

          {/* Stadium + VSTAR */}
          <div className="flex flex-col gap-2 shrink-0">
            <div className="bg-black/30 rounded-xl border border-white/10 p-2 flex flex-col items-center justify-center" style={{ width: 80, height: 88 }}>
              <div className="text-[9px] text-white/30 mb-1">スタジアム</div>
              <EmptySlot size="sm" />
            </div>
            <div className="bg-yellow-900/40 rounded-xl border border-yellow-600/40 p-2 flex items-center justify-center" style={{ width: 80, height: 36 }}>
              <span className="font-black text-yellow-400 text-sm tracking-wider">VSTAR</span>
            </div>
          </div>
        </div>

        {/* Row 2: Bench */}
        <div className="flex gap-1.5">
          {BENCH_ZONES.map((zone, i) => (
            <DropZone key={zone} {...dropProps(zone)} className="flex-1 bg-black/30 rounded-xl border border-white/10 p-1.5 flex flex-col items-center min-w-0 overflow-hidden">
              <div className="text-[9px] text-white/30 mb-1">ベンチ{i + 1}</div>
              {board[zone].length > 0 ? (
                <StackedCards cards={board[zone]} draggingId={dragging?.instanceId ?? null} selectedIds={boardSelected} size="sm" zone={zone} onClick={handleBoardCardClick} {...sharedCardProps} />
              ) : (
                <EmptySlot size="sm" />
              )}
            </DropZone>
          ))}
        </div>

        {/* Row 3: hand + trash + deck controls */}
        <div className="flex gap-2 items-start">

          {/* Hand */}
          <DropZone {...dropProps("hand")} className="flex-1 bg-black/30 rounded-xl border border-white/10 p-2 min-w-0">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[10px] text-white/40">手札 ({board.hand.length})</span>
              {board.hand.length > 0 && deckCards.length > 0 && (
                <button onClick={() => sortZone("hand")} className="text-[9px] text-white/40 hover:text-white/70 border border-white/20 hover:border-white/40 rounded px-1.5 py-0.5 transition-colors">
                  デッキ順
                </button>
              )}
            </div>
            {/* Real draw effect buttons */}
            {deckCards.length > 0 && (
              <div className="flex gap-1 overflow-x-auto pb-1.5 mb-1.5 border-b border-white/10">
                {(["hakase","lillie_strong","lillie_weak","unfair5","unfair2","redcard","sakateni","dash","midori"] as const).map((key) => {
                  const ef = DEFAULT_EFFECTS.find((e) => e.key === key);
                  if (!ef) return null;
                  return (
                    <button key={key} onClick={() => performHandEffect(key)} title={`${ef.label} — ${ef.description}`}
                      className="shrink-0 rounded overflow-hidden border-2 border-transparent hover:border-green-400 active:scale-95 transition-all"
                      style={{ width: 36, height: 50 }}>
                      {ef.imageUrl
                        ? <img src={ef.imageUrl} alt={ef.label} className="w-full h-full object-cover" />
                        : <div className="w-full h-full bg-gray-700 flex items-center justify-center text-[9px]">{ef.short}</div>
                      }
                    </button>
                  );
                })}
              </div>
            )}
            <div className="flex gap-1 overflow-x-auto pb-1" style={{ minHeight: 90 }}>
              {board.hand.length > 0 ? (
                board.hand.map((c) => (
                  <Card key={c.instanceId} card={c} size="md" isDragging={dragging?.instanceId === c.instanceId} isSelected={boardSelected.has(c.instanceId)} zone="hand" onClick={handleBoardCardClick} {...sharedCardProps} />
                ))
              ) : (
                <div className="text-white/20 text-xs self-center px-2">
                  {deckCards.length === 0 ? "デッキコードを入力" : "「セット」で7枚ドロー"}
                </div>
              )}
            </div>
          </DropZone>

          {/* Trash */}
          <DropZone {...dropProps("trash")} className="bg-black/30 rounded-xl border border-white/10 p-2 flex flex-col items-center shrink-0" style={{ width: 80 }}>
            <div className="text-[10px] text-white/40 mb-0.5">トラッシュ</div>
            <div className="text-[10px] text-white/30 mb-1">({board.trash.length})</div>
            {board.trash.length > 0 ? (
              <StackedCards cards={board.trash.slice(-4)} draggingId={dragging?.instanceId ?? null} selectedIds={boardSelected} size="sm" zone="trash" onClick={handleBoardCardClick} {...sharedCardProps} />
            ) : (
              <EmptySlot size="sm" />
            )}
            {board.trash.length > 0 && deckCards.length > 0 && (
              <button
                onClick={() => sortZone("trash")}
                className="mt-1.5 text-[9px] text-white/40 hover:text-white/70 border border-white/20 hover:border-white/40 rounded px-1.5 py-0.5 transition-colors"
              >
                デッキ順
              </button>
            )}
          </DropZone>

          {/* Deck */}
          <div className="bg-black/30 rounded-xl border border-white/10 p-2 flex flex-col items-center shrink-0 gap-1" style={{ width: 90 }}>
            <div className="text-[10px] text-white/40">山札 ({board.deck.length})</div>
            <DropZone {...dropProps("deck")}>
              <div onClick={drawOne} className="cursor-pointer" title="クリックで1枚ドロー">
                {board.deck.length > 0 ? <CardBack size="sm" /> : <EmptySlot size="sm" />}
              </div>
            </DropZone>
            {/* Draw N */}
            <div className="flex gap-1 items-center w-full">
              <input
                type="number"
                min={1}
                max={board.deck.length || 1}
                value={drawCount}
                onChange={(e) => setDrawCount(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-8 bg-black/40 border border-white/20 rounded text-center text-[10px] text-white py-0.5 focus:outline-none"
              />
              <button
                onClick={drawN}
                disabled={board.deck.length === 0}
                className="flex-1 text-[9px] bg-white/10 hover:bg-white/20 disabled:opacity-30 rounded px-1 py-1 transition-colors"
              >
                枚引く
              </button>
            </div>
            {/* Shuffle */}
            <button
              onClick={shuffleDeck}
              disabled={board.deck.length < 2}
              className="w-full text-[9px] bg-white/10 hover:bg-white/20 disabled:opacity-30 rounded px-1 py-1 transition-colors"
            >
              シャッフル
            </button>
            {/* Sort deck */}
            {board.deck.length > 0 && deckCards.length > 0 && (
              <button
                onClick={() => sortZone("deck")}
                className="w-full text-[9px] bg-white/10 hover:bg-white/20 rounded px-1 py-1 transition-colors"
              >
                デッキ順
              </button>
            )}
            {/* Open deck viewer */}
            <button
              onClick={() => setDeckViewerOpen((p) => !p)}
              disabled={board.deck.length === 0}
              className={`w-full text-[9px] rounded px-1 py-1 transition-colors disabled:opacity-30 ${
                deckViewerOpen ? "bg-yellow-600 text-black font-bold" : "bg-white/10 hover:bg-white/20"
              }`}
            >
              山札を見る
            </button>
          </div>
        </div>

        {/* ── Deck Viewer ── */}
        {deckViewerOpen && (
          <div className="bg-gray-950 rounded-xl border border-gray-700 overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-800">
              <span className="text-sm font-bold">山札 ({board.deck.length}枚)</span>
              {deckCards.length > 0 && (
                <button
                  onClick={() => sortZone("deck")}
                  className="text-[9px] text-white/50 hover:text-white border border-white/20 hover:border-white/40 rounded px-1.5 py-0.5 transition-colors"
                >
                  デッキ順
                </button>
              )}
              <button
                onClick={shuffleDeck}
                className="text-[9px] text-white/50 hover:text-white border border-white/20 hover:border-white/40 rounded px-1.5 py-0.5 transition-colors"
              >
                シャッフル
              </button>
              <div className="flex-1" />
              <span className="text-[9px] text-white/30">ダブルクリックで確率計算</span>
              <button
                onClick={() => setDeckViewerOpen(false)}
                className="text-gray-500 hover:text-white text-lg leading-none ml-1"
              >
                ×
              </button>
            </div>

            {/* ── Inline probability bar ── */}
            {dvProb && (
              <div className="bg-gray-900 border-b border-gray-800 px-3 py-2.5 flex flex-col gap-2.5">

                {/* Row 1: targets + condition + result + close */}
                <div className="flex items-start gap-3 flex-wrap">
                  <span className="text-yellow-400 text-sm shrink-0 mt-1">🎯</span>

                  {/* Target pills with minCount */}
                  <div className="flex flex-wrap items-center gap-2 flex-1 min-w-0">
                    {dvProb.targets.length === 0 ? (
                      <span className="text-xs text-gray-500 italic">カードをダブルクリックして選択</span>
                    ) : (
                      dvProb.targets.map((target, i) => {
                        const card = deckCards.find((c) => c.id === target.cardId);
                        const inDeck = dvTargetCounts[i] ?? 0;
                        return (
                          <div key={target.cardId} className="flex items-center gap-1.5 bg-yellow-900/30 border border-yellow-700/50 rounded-lg px-2 py-1">
                            {card?.imageUrl && <img src={card.imageUrl} className="w-7 h-9 object-cover rounded shrink-0" />}
                            <div className="min-w-0">
                              <div className="text-[10px] text-yellow-200 max-w-[80px] truncate">{card?.name}</div>
                              <div className="text-[10px] text-blue-400">山 {inDeck}枚</div>
                            </div>
                            {/* minCount spinner */}
                            <div className="flex flex-col items-center ml-1">
                              <span className="text-[8px] text-gray-500 leading-none">最低</span>
                              <div className="flex items-center gap-0.5 mt-0.5">
                                <button onClick={() => setDvTargetMinCount(target.cardId, Math.max(1, target.minCount - 1))} className="w-4 h-4 bg-gray-700 hover:bg-gray-600 rounded text-xs leading-none flex items-center justify-center">−</button>
                                <span className="text-xs font-bold text-white w-4 text-center">{target.minCount}</span>
                                <button onClick={() => setDvTargetMinCount(target.cardId, Math.min(4, target.minCount + 1))} className="w-4 h-4 bg-gray-700 hover:bg-gray-600 rounded text-xs leading-none flex items-center justify-center">＋</button>
                              </div>
                            </div>
                            <button onClick={() => handleDvDoubleClick(target.cardId)} className="text-gray-600 hover:text-red-400 text-sm ml-0.5 shrink-0" title="解除">×</button>
                          </div>
                        );
                      })
                    )}

                    {/* AND/OR toggle (shown when 2+ targets) */}
                    {dvProb.targets.length >= 2 && (
                      <div className="flex items-center gap-1 border border-gray-700 rounded-lg overflow-hidden">
                        <button
                          onClick={() => setDvProb((p) => p ? { ...p, condition: "any" } : p)}
                          className={`text-[10px] px-2 py-1 transition-colors ${dvProb.condition === "any" ? "bg-indigo-600 text-white" : "text-gray-500 hover:text-gray-300"}`}
                        >
                          OR
                        </button>
                        <button
                          onClick={() => setDvProb((p) => p ? { ...p, condition: "all" } : p)}
                          className={`text-[10px] px-2 py-1 transition-colors ${dvProb.condition === "all" ? "bg-indigo-600 text-white" : "text-gray-500 hover:text-gray-300"}`}
                        >
                          AND
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Result */}
                  <div className="shrink-0 text-right">
                    {dvProb.steps.length > 0 && dvProb.targets.length > 0 ? (
                      <div className={`text-4xl font-bold tabular-nums leading-none ${
                        dvProbability === null ? "text-gray-600" : dvProbability >= 0.8 ? "text-green-400" : dvProbability >= 0.5 ? "text-yellow-400" : "text-red-400"
                      }`}>
                        {dvProbability === null ? "—" : formatPct(dvProbability)}
                      </div>
                    ) : (
                      <span className="text-xs text-gray-600">↓効果を選択</span>
                    )}
                  </div>

                  <button onClick={() => setDvProb(null)} className="text-gray-600 hover:text-white text-xl leading-none shrink-0 mt-0.5" title="確率モード終了">×</button>
                </div>

                {/* Row 2: effect buttons + steps */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
                  {DEFAULT_EFFECTS.map((effect) => (
                    <button key={effect.key} onClick={() => addDvStep(effect.key)} title={`${effect.label} — ${effect.description}`}
                      className="shrink-0 rounded overflow-hidden border-2 border-transparent hover:border-red-500 active:scale-95 transition-all"
                      style={{ width: 40, height: 56 }}>
                      {effect.imageUrl
                        ? <img src={effect.imageUrl} alt={effect.label} className="w-full h-full object-cover" />
                        : <div className="w-full h-full bg-gray-700 flex items-center justify-center text-[9px] text-gray-400">{effect.short}</div>
                      }
                    </button>
                  ))}

                  {/* Steps */}
                  {dvProb.steps.length > 0 && (
                    <div className="flex items-center gap-1 ml-2 pl-2 border-l border-gray-700 shrink-0">
                      {dvProb.steps.map((step) => {
                        const effect = DEFAULT_EFFECTS.find((e) => e.key === step.effectKey);
                        if (!effect) return null;
                        return (
                          <div key={step.id} className="flex items-center">
                            {effect.imageUrl
                              ? <img src={effect.imageUrl} className="w-7 h-10 object-cover rounded" title={effect.label} />
                              : <span className="text-[9px] text-gray-400 px-1">{effect.short}</span>
                            }
                            <button onClick={() => setDvProb((p) => p ? { ...p, steps: p.steps.filter((s) => s.id !== step.id) } : p)}
                              className="text-gray-700 hover:text-red-400 text-xs leading-none -ml-1 -mt-3 z-10">×</button>
                          </div>
                        );
                      })}
                      <button
                        onClick={() => setDvProb((p) => p ? { ...p, steps: [] } : p)}
                        className="text-[10px] font-semibold text-red-400 hover:text-red-300 bg-red-900/30 hover:bg-red-900/50 border border-red-800/50 rounded px-2 py-1 ml-1 transition-colors shrink-0"
                      >
                        クリア
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Card grid */}
            <DropZone {...dropProps("deck")} className="p-3">
              <div className="flex flex-wrap gap-1.5">
                {board.deck.map((c, i) => {
                  const isTarget = dvProb?.targets.some((t) => t.cardId === c.cardId);
                  return (
                    <div
                      key={c.instanceId}
                      className="flex flex-col items-center gap-0.5"
                      onDoubleClick={() => handleDvDoubleClick(c.cardId)}
                    >
                      <div className={`rounded-lg transition-all ${isTarget ? "ring-2 ring-yellow-400 scale-105" : ""}`}>
                        <Card
                          card={{ ...c, faceDown: false }}
                          size="sm"
                          zone="deck"
                          isDragging={dragging?.instanceId === c.instanceId}
                          {...sharedCardProps}
                        />
                      </div>
                      <span className="text-[8px] text-gray-600">{board.deck.length - i}</span>
                    </div>
                  );
                })}
                {board.deck.length === 0 && (
                  <p className="text-gray-600 text-sm">山札にカードがありません</p>
                )}
              </div>
            </DropZone>
          </div>
        )}
      </div>

      {/* ── Board selection action bar ── */}
      {boardSelected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 bg-gray-950/95 border-t border-gray-700 backdrop-blur px-4 py-2.5 flex items-center gap-2 z-30 flex-wrap shadow-2xl">
          <span className="text-xs font-medium text-blue-400 shrink-0">{boardSelected.size}枚選択中</span>
          <div className="w-px h-4 bg-gray-700 shrink-0" />
          <button onClick={() => boardMoveSelected("trash")} className="text-[11px] bg-gray-700 hover:bg-gray-600 text-white rounded px-3 py-1.5 transition-colors shrink-0">トラッシュ</button>
          <button onClick={() => boardMoveSelected("shuffle")} className="text-[11px] bg-gray-700 hover:bg-gray-600 text-white rounded px-3 py-1.5 transition-colors shrink-0">山札に戻してシャッフル</button>
          <button onClick={() => boardMoveSelected("top")} className="text-[11px] bg-blue-800 hover:bg-blue-700 text-white rounded px-3 py-1.5 transition-colors shrink-0">
            {boardSelected.size > 1 ? "シャッフルして山札の上" : "山札の上に置く"}
          </button>
          <button onClick={() => boardMoveSelected("bottom")} className="text-[11px] bg-purple-800 hover:bg-purple-700 text-white rounded px-3 py-1.5 transition-colors shrink-0">
            {boardSelected.size > 1 ? "シャッフルして山札の下" : "山札の下に置く"}
          </button>
          <button onClick={() => setBoardSelected(new Set())} className="ml-auto text-[11px] text-gray-500 hover:text-gray-300 transition-colors shrink-0">選択解除</button>
        </div>
      )}

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
                      className="shrink-0 rounded overflow-hidden border-2 border-transparent hover:border-red-500 transition-colors"
                      style={{ width: 44, height: 60 }}
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
                                  p.map((s) =>
                                    s.id === step.id ? { ...s, compress: Math.max(0, Math.min(30, parseInt(e.target.value || "0"))) } : s
                                  )
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
                      <p className="text-xs text-gray-500 mt-1">{steps.length}手順後に1枚以上引ける確率</p>
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

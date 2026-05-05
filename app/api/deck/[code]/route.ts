import { NextResponse } from "next/server";
import { DeckCard } from "@/lib/types";

const CATEGORY_MAP: Record<string, DeckCard["category"]> = {
  deck_pke: "pokemon",
  deck_gds: "trainer",
  deck_tool: "trainer",
  deck_tech: "trainer",
  deck_sup: "trainer",
  deck_sta: "trainer",
  deck_ajs: "trainer",
  deck_ene: "energy",
};

export async function GET(_req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!code || !/^[a-zA-Z0-9_-]{4,20}$/.test(code)) {
    return NextResponse.json({ error: "無効なデッキコードです" }, { status: 400 });
  }

  const url = `https://www.pokemon-card.com/deck/result.html/deckID/${code}/`;
  let html: string;
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "ja,en-US;q=0.9,en;q=0.8",
        Referer: "https://www.pokemon-card.com/",
      },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return NextResponse.json({ error: "デッキページの取得に失敗しました" }, { status: 502 });
    html = await res.text();
  } catch {
    return NextResponse.json({ error: "ネットワークエラーが発生しました" }, { status: 502 });
  }

  // Parse card names and images from PCGDECK JS object
  const nameMap: Record<string, string> = {};
  const altNameMap: Record<string, string> = {};
  const pictMap: Record<string, string> = {};

  for (const [, id, name] of html.matchAll(/PCGDECK\.searchItemName\[(\d+)\]='([^']+)'/g)) {
    nameMap[id] = name;
  }
  for (const [, id, name] of html.matchAll(/PCGDECK\.searchItemNameAlt\[(\d+)\]='([^']+)'/g)) {
    altNameMap[id] = name;
  }
  for (const [, id, path] of html.matchAll(/PCGDECK\.searchItemCardPict\[(\d+)\]='([^']+)'/g)) {
    pictMap[id] = `https://www.pokemon-card.com${path}`;
  }

  // Parse card IDs and counts from hidden form fields
  const cards: DeckCard[] = [];
  const seenIds = new Set<string>();

  for (const inputTag of html.matchAll(/<input[^>]+>/g)) {
    const nameMatch = inputTag[0].match(/name="([^"]+)"/);
    const valueMatch = inputTag[0].match(/value="([^"]+)"/);
    if (!nameMatch || !valueMatch) continue;
    const fieldName = nameMatch[1];
    const fieldValue = valueMatch[1];

    const category = CATEGORY_MAP[fieldName];
    if (!category || !fieldValue || fieldValue === "0") continue;

    for (const entry of fieldValue.split("-").filter(Boolean)) {
      const parts = entry.split("_");
      const id = parts[0];
      const count = parseInt(parts[1] || "1", 10);
      if (!id || !nameMap[id] || seenIds.has(id)) continue;
      seenIds.add(id);
      cards.push({
        id,
        name: altNameMap[id] || nameMap[id],
        imageUrl: pictMap[id] || "",
        totalCount: count,
        category,
      });
    }
  }

  if (cards.length === 0) {
    return NextResponse.json({ error: "デッキが見つかりませんでした。デッキコードを確認してください。" }, { status: 404 });
  }

  return NextResponse.json({ cards });
}

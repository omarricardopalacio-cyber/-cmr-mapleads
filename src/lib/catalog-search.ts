/**
 * Normalización de consultas de catálogo: plurales, typos y referencias ("el 6 niveles").
 */

import type { CatalogProduct } from "./catalog.server";

const TYPO_MAP: Record<string, string> = {
  siyas: "silla",
  siya: "silla",
  sillas: "silla",
  zapateros: "zapatero",
  zapatro: "zapatero",
  zapatera: "zapatero",
  organizadores: "organizador",
  masajeadores: "masajeador",
  masajeader: "masajeador",
};

/** Singulariza palabras en español de forma conservadora. */
export function singularizeSpanish(word: string): string {
  const w = word.toLowerCase().trim();
  if (w.length < 4) return w;
  if (TYPO_MAP[w]) return TYPO_MAP[w];
  if (w.endsWith("iones")) return w.slice(0, -2);
  if (w.endsWith("es") && w.length > 4) return w.slice(0, -2);
  if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) return w.slice(0, -1);
  return w;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

/** Corrige typos conocidos o por distancia a palabras del catálogo. */
export function correctSpelling(token: string, vocabulary: string[] = []): string {
  const lower = token.toLowerCase().trim();
  if (!lower || lower.length < 3) return lower;
  if (TYPO_MAP[lower]) return TYPO_MAP[lower];

  let best = lower;
  let bestDist = 3;
  const singular = singularizeSpanish(lower);
  for (const word of vocabulary) {
    if (word.length < 3) continue;
    const d = levenshtein(singular, word);
    if (d < bestDist) {
      bestDist = d;
      best = word;
    }
  }
  return bestDist <= 2 ? best : singular;
}

/** Genera variantes de búsqueda para PostgREST (plural, singular, typo). */
export function expandSearchTerms(rawQuery: string, vocabulary: string[] = []): string[] {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return [];

  const terms = new Set<string>();
  terms.add(q);

  const words = q.split(/\s+/).filter((w) => w.length >= 2);
  for (const word of words) {
    terms.add(word);
    terms.add(singularizeSpanish(word));
    terms.add(correctSpelling(word, vocabulary));
  }

  if (words.length > 1) {
    const corrected = words.map((w) => correctSpelling(w, vocabulary));
    terms.add(corrected.join(" "));
    terms.add(corrected.map(singularizeSpanish).join(" "));
  }

  return [...terms].filter((t) => t.length >= 2).slice(0, 12);
}

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, " ");
}

function tokenize(s: string): string[] {
  return normalizeText(s)
    .split(/\s+/)
    .filter((t) => t.length >= 2 || /^\d+$/.test(t));
}

/**
 * Resuelve "el 6 niveles", "JDM-62", "masajeador cuello" contra la última lista mostrada.
 */
export function resolveProductFromReference(
  reference: string,
  products: CatalogProduct[],
): CatalogProduct | null {
  if (!reference?.trim() || !products.length) return null;

  const ref = normalizeText(reference);
  const refTokens = tokenize(reference);

  let best: CatalogProduct | null = null;
  let bestScore = 0;

  for (const p of products) {
    const nameNorm = normalizeText(p.name);
    const skuNorm = p.sku ? normalizeText(p.sku) : "";
    let score = 0;

    if (ref.length >= 4 && nameNorm.includes(ref)) score += 50;
    if (p.sku && ref.includes(skuNorm)) score += 80;
    if (p.sku && refTokens.some((t) => skuNorm.includes(t))) score += 60;

    for (const t of refTokens) {
      if (t.length < 2) continue;
      if (/^\d+$/.test(t) && nameNorm.includes(t)) score += 25;
      if (nameNorm.includes(t)) score += 15;
      if (skuNorm && skuNorm.includes(t)) score += 20;
    }

    const refNums = refTokens.filter((t) => /^\d+$/.test(t));
    const refWords = refTokens.filter((t) => !/^\d+$/.test(t));
    if (refNums.length && refWords.length) {
      const allNums = refNums.every((n) => nameNorm.includes(n));
      const wordHits = refWords.filter((w) => nameNorm.includes(w)).length;
      if (allNums && wordHits >= Math.min(1, refWords.length)) score += 40;
    }

    if (score > bestScore) {
      bestScore = score;
      best = p;
    }
  }

  return bestScore >= 20 ? best : null;
}

export function resolveProductId(
  productIdOrRef: string,
  lastProducts: CatalogProduct[],
  catalogCfg: { products_table?: string } | null,
  fetchById: (id: string) => Promise<CatalogProduct | null>,
  searchFn: (q: string, limit: number) => Promise<CatalogProduct[]>,
): Promise<CatalogProduct | null> {
  const raw = productIdOrRef.trim();
  if (!raw) return Promise.resolve(null);

  const fromList = resolveProductFromReference(raw, lastProducts);
  if (fromList) return Promise.resolve(fromList);

  const uuidLike = /^[0-9a-f-]{36}$/i.test(raw);
  if (uuidLike) {
    return fetchById(raw);
  }

  return searchFn(raw, 5).then((hits) => resolveProductFromReference(raw, hits) ?? hits[0] ?? null);
}

export function buildSearchVocabulary(products: CatalogProduct[]): string[] {
  const vocab = new Set<string>();
  for (const p of products) {
    for (const t of tokenize(p.name)) {
      if (t.length >= 4) vocab.add(singularizeSpanish(t));
    }
    if (p.sku) vocab.add(normalizeText(p.sku));
  }
  return [...vocab];
}

/**
 * FAQ matching : normalisation + scoring (mots exacts, bonus mots rares).
 * Stopwords FR + tokens >= 4 lettres pour éviter collisions (ex. "charges" dossier vs "charges" copro).
 */

export type FaqItem = {
  id: string;
  question: string;
  answer: string;
  updated_at?: string;
};

export type MatchResult = {
  match: null | { item: FaqItem; score: number };
  candidates: Array<{ item: FaqItem; score: number }>;
  /** Top 3 (id, score) pour debug quand showDebug=true */
  topCandidates?: Array<{ id: string; score: number }>;
};

const DEFAULT_THRESHOLD = 0.35;
const MIN_TOKEN_LEN = 4;

const FR_STOPWORDS = new Set([
  "les", "des", "une", "est", "sont", "dans", "pour", "pas", "que", "qui", "par", "sur", "avec", "mais", "tout", "fait", "plus", "autre", "comme", "sans", "sous", "entre", "vers", "donc", "aux", "ce", "cet", "cette", "ces", "mon", "ton", "son", "ma", "ta", "sa", "mes", "tes", "ses", "notre", "votre", "leur", "nos", "vos", "leurs", "le", "la", "l", "d", "n", "qu", "il", "elle", "on", "nous", "vous", "ils", "elles", "et", "ou", "si", "ne", "du", "au", "ceux", "celles", "quel", "quelle", "quels", "quelles", "quoi", "dossier", "documents", "piece", "pieces", "document",
]);

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokens >= MIN_TOKEN_LEN, hors stopwords FR. */
function tokenize(normalized: string): Set<string> {
  const tokens = normalized
    .split(" ")
    .map((t) => t.trim())
    .filter((t) => t.length >= MIN_TOKEN_LEN && !FR_STOPWORDS.has(t));
  return new Set(tokens);
}

/** Nombre d’occurrences d’un token dans tous les items (pour bonus mots rares). */
function tokenFrequencyInCorpus(tokens: Set<string>, items: { question: string }[]): Map<string, number> {
  const norm = (s: string) => normalize(s);
  const freq = new Map<string, number>();
  for (const item of items) {
    const qTokens = tokenize(norm(item.question ?? ""));
    for (const t of qTokens) {
      if (tokens.has(t)) freq.set(t, (freq.get(t) ?? 0) + 1);
    }
  }
  return freq;
}

/** Score : poids fort sur mots exacts, bonus mots rares. */
function scoreOverlap(
  queryTokens: Set<string>,
  questionTokens: Set<string>,
  corpusFreq: Map<string, number>,
  totalItems: number
): number {
  if (queryTokens.size === 0) return 0;
  let exact = 0;
  let partial = 0;
  let rareBonus = 0;
  for (const t of queryTokens) {
    if (questionTokens.has(t)) {
      exact += 1;
      const f = corpusFreq.get(t) ?? 0;
      if (totalItems > 0 && f < totalItems) rareBonus += (totalItems - f) / Math.max(totalItems, 1);
    } else {
      for (const q of questionTokens) {
        if (q.includes(t) || t.includes(q)) {
          partial += 0.5;
          break;
        }
      }
    }
  }
  const base = (exact * 1.2 + partial * 0.5) / queryTokens.size;
  const rare = totalItems > 0 ? Math.min(0.2, rareBonus / (queryTokens.size * totalItems)) : 0;
  return Math.min(1, base + rare);
}

/**
 * Cherche le meilleur match FAQ pour un texte (sujet + corps du message).
 * - match: premier item dont le score >= threshold, ou null
 * - candidates: tous les items avec leur score (triés par score décroissant)
 * - topCandidates: si showDebug=true, top 3 (id, score)
 */
export function matchFaq(
  faqItems: FaqItem[],
  questionText: string,
  options?: { threshold?: number; showDebug?: boolean }
): MatchResult {
  const threshold = options?.threshold ?? DEFAULT_THRESHOLD;
  const showDebug = options?.showDebug === true;
  const normalizedQuery = normalize(questionText || "");
  const queryTokens = tokenize(normalizedQuery);
  if (queryTokens.size === 0) {
    return { match: null, candidates: [], ...(showDebug ? { topCandidates: [] } : {}) };
  }

  const corpusFreq = tokenFrequencyInCorpus(queryTokens, faqItems);
  const totalItems = faqItems.length;

  const scored = faqItems.map((item) => {
    const normalizedQ = normalize(item.question || "");
    const questionTokens = tokenize(normalizedQ);
    const score = scoreOverlap(queryTokens, questionTokens, corpusFreq, totalItems);
    return { item, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const candidates = scored.filter((c) => c.score > 0);
  const best = candidates[0];
  const match = best && best.score >= threshold ? { item: best.item, score: best.score } : null;

  const topCandidates = showDebug
    ? candidates.slice(0, 3).map((c) => ({ id: c.item.id, score: c.score }))
    : undefined;

  return { match, candidates, ...(topCandidates !== undefined ? { topCandidates } : {}) };
}

/** Même normalisation que le matching (pour déduplication FAQ). */
export function normalizeFaqQuestion(text: string): string {
  return normalize(text);
}

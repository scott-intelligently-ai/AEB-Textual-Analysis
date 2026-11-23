/**
 * Term matching shared by frequency counting, tone highlighting, and term
 * discovery, so that every screen agrees on what counts as an occurrence.
 *
 * Rules: case-insensitive, whole words only, any run of whitespace between the
 * words of a phrase, and straight and curly quotes treated alike. Occurrences
 * never overlap: the leftmost match wins, and at the same position the longest
 * pattern wins, so "tax cut" is not also counted as "tax".
 */

export interface TermPattern {
  id: number;
  text: string;
  variants?: string[];
}

export interface Occurrence {
  termId: number;
  start: number;
  end: number;
  text: string;
}

const APOSTROPHES = "'\u2018\u2019\u02bc";
const DOUBLE_QUOTES = '"\u201c\u201d';
const HYPHENS = "\\-\u2010\u2011";
const WORD_CHAR = "[\\p{L}\\p{N}_]";

/** Canonical form used to detect duplicate terms regardless of case or spacing. */
export function normalizeTerm(value: string): string {
  return value
    .replace(new RegExp(`[${APOSTROPHES}]`, "g"), "'")
    .replace(new RegExp(`[${DOUBLE_QUOTES}]`, "g"), '"')
    .replace(new RegExp(`[${HYPHENS}]`, "g"), "-")
    .trim()
    .split(/\s+/)
    .join(" ")
    .toLowerCase();
}

function escapeChar(char: string): string {
  if (APOSTROPHES.includes(char)) return `[${APOSTROPHES}]`;
  if (DOUBLE_QUOTES.includes(char)) return `[${DOUBLE_QUOTES}]`;
  if (char === "-" || char === "\u2010" || char === "\u2011") return `[${HYPHENS}]`;
  return /[\\^$.*+?()[\]{}|/]/.test(char) ? `\\${char}` : char;
}

function patternSource(normalized: string): string {
  const body = normalized
    .split(" ")
    .map((word) => Array.from(word).map(escapeChar).join(""))
    .join("\\s+");
  const chars = Array.from(normalized);
  const isWord = (char: string) => /[\p{L}\p{N}_]/u.test(char);
  const before = isWord(chars[0]) ? `(?<!${WORD_CHAR})` : "";
  const after = isWord(chars[chars.length - 1]) ? `(?!${WORD_CHAR})` : "";
  return `${before}${body}${after}`;
}

export interface Matcher {
  find(text: string): Occurrence[];
}

const EMPTY_MATCHER: Matcher = { find: () => [] };

export function buildMatcher(terms: TermPattern[]): Matcher {
  const seen = new Set<string>();
  const patterns: { termId: number; normalized: string }[] = [];
  for (const term of terms) {
    for (const raw of [term.text, ...(term.variants ?? [])]) {
      const normalized = normalizeTerm(raw);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      patterns.push({ termId: term.id, normalized });
    }
  }
  if (patterns.length === 0) return EMPTY_MATCHER;

  // Alternation is tried in order, so longer patterns go first.
  patterns.sort((a, b) => b.normalized.length - a.normalized.length);
  const regex = new RegExp(
    patterns.map((p) => `(${patternSource(p.normalized)})`).join("|"),
    "giu",
  );

  return {
    find(text: string): Occurrence[] {
      const occurrences: Occurrence[] = [];
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        if (match[0].length === 0) {
          regex.lastIndex += 1;
          continue;
        }
        let group = 1;
        while (group < match.length && match[group] === undefined) group += 1;
        occurrences.push({
          termId: patterns[group - 1].termId,
          start: match.index,
          end: match.index + match[0].length,
          text: match[0],
        });
      }
      return occurrences;
    },
  };
}

export function findOccurrences(text: string, terms: TermPattern[]): Occurrence[] {
  return buildMatcher(terms).find(text);
}

export function countOccurrences(text: string, phrase: string): number {
  return findOccurrences(text, [{ id: 0, text: phrase }]).length;
}

export interface FrequencyDocument {
  id: number;
  title: string;
  text: string;
}

export interface FrequencyTable {
  documents: { id: number; title: string; total: number }[];
  rows: { termId: number; term: string; counts: number[]; total: number }[];
  grandTotal: number;
}

export function frequencyTable(
  documents: FrequencyDocument[],
  terms: TermPattern[],
): FrequencyTable {
  const matcher = buildMatcher(terms);
  const rowIndex = new Map(terms.map((term, i) => [term.id, i]));
  const rows = terms.map((term) => ({
    termId: term.id,
    term: term.text,
    counts: documents.map(() => 0),
    total: 0,
  }));
  const docTotals = documents.map(() => 0);

  documents.forEach((document, d) => {
    for (const occurrence of matcher.find(document.text)) {
      const row = rows[rowIndex.get(occurrence.termId)!];
      row.counts[d] += 1;
      row.total += 1;
      docTotals[d] += 1;
    }
  });

  return {
    documents: documents.map((document, d) => ({
      id: document.id,
      title: document.title,
      total: docTotals[d],
    })),
    rows,
    grandTotal: docTotals.reduce((sum, n) => sum + n, 0),
  };
}

export function spanKey(span: { start: number; end: number }): string {
  return `${span.start}:${span.end}`;
}

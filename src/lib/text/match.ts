/**
 * Term matching shared by frequency counting, tone highlighting, and term
 * discovery, so that every screen agrees on what counts as an occurrence.
 *
 * Rules: case-insensitive unless the term is marked case sensitive. A
 * case-sensitive term's variants still match any capitalization. Matching is
 * whole words only, with any run of whitespace between the words of a phrase,
 * and straight and curly quotes treated alike. Occurrences never overlap: the
 * leftmost match wins, and at the same position the longest pattern wins, so
 * "tax cut" is not also counted as "tax".
 */

export interface TermPattern {
  id: number;
  text: string;
  variants?: string[];
  /** When true, only this capitalization of the term itself matches. Variants stay case-insensitive. */
  caseSensitive?: boolean;
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

/** Spelling used for matching, with quotes and spacing folded. Case is kept when asked. */
export function canonicalizeTerm(value: string, foldCase: boolean): string {
  const cleaned = value
    .replace(new RegExp(`[${APOSTROPHES}]`, "g"), "'")
    .replace(new RegExp(`[${DOUBLE_QUOTES}]`, "g"), '"')
    .replace(new RegExp(`[${HYPHENS}]`, "g"), "-")
    .trim()
    .split(/\s+/)
    .join(" ");
  return foldCase ? cleaned.toLowerCase() : cleaned;
}

/** Canonical form used to detect duplicate terms regardless of case or spacing. */
export function normalizeTerm(value: string): string {
  return canonicalizeTerm(value, true);
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

interface CompiledPattern {
  termId: number;
  normalized: string;
  order: number;
}

interface Hit extends Occurrence {
  rank: number;
  order: number;
}

function compile(patterns: CompiledPattern[], flags: string): { regex: RegExp; patterns: CompiledPattern[] } | null {
  if (patterns.length === 0) return null;
  // Alternation is tried in order, so longer patterns go first.
  const ordered = [...patterns].sort((a, b) => b.normalized.length - a.normalized.length || a.order - b.order);
  return {
    patterns: ordered,
    regex: new RegExp(ordered.map((pattern) => `(${patternSource(pattern.normalized)})`).join("|"), flags),
  };
}

function scan(text: string, compiled: { regex: RegExp; patterns: CompiledPattern[] } | null): Hit[] {
  if (!compiled) return [];
  const hits: Hit[] = [];
  compiled.regex.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = compiled.regex.exec(text)) !== null) {
    if (match[0].length === 0) {
      compiled.regex.lastIndex += 1;
      continue;
    }
    let group = 1;
    while (group < match.length && match[group] === undefined) group += 1;
    const pattern = compiled.patterns[group - 1];
    hits.push({
      termId: pattern.termId,
      start: match.index,
      end: match.index + match[0].length,
      text: match[0],
      rank: pattern.normalized.length,
      order: pattern.order,
    });
  }
  return hits;
}

/** Leftmost match wins. At the same position the longer pattern wins. */
function keepNonOverlapping(hits: Hit[]): Occurrence[] {
  const ordered = [...hits].sort((a, b) => a.start - b.start || b.rank - a.rank || a.order - b.order);
  const kept: Occurrence[] = [];
  let coveredUntil = -1;
  for (const hit of ordered) {
    if (hit.start < coveredUntil) continue;
    kept.push({ termId: hit.termId, start: hit.start, end: hit.end, text: hit.text });
    coveredUntil = hit.end;
  }
  return kept;
}

export function buildMatcher(terms: TermPattern[]): Matcher {
  const seen = new Set<string>();
  const insensitive: CompiledPattern[] = [];
  const sensitive: CompiledPattern[] = [];
  let order = 0;
  for (const term of terms) {
    const pieces = [term.text, ...(term.variants ?? [])];
    for (const [index, raw] of pieces.entries()) {
      const key = normalizeTerm(raw);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      const exact = index === 0 && term.caseSensitive === true;
      const pattern = {
        termId: term.id,
        normalized: canonicalizeTerm(raw, !exact),
        order,
      };
      order += 1;
      (exact ? sensitive : insensitive).push(pattern);
    }
  }
  if (insensitive.length === 0 && sensitive.length === 0) return EMPTY_MATCHER;

  const either = compile(insensitive, "giu");
  const exact = compile(sensitive, "gu");

  return {
    find(text: string): Occurrence[] {
      return keepNonOverlapping([...scan(text, either), ...scan(text, exact)]);
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

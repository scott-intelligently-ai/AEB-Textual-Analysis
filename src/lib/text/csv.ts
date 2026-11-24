import { normalizeTerm } from "./match";

function escapeCell(value: string | number): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(rows: (string | number)[][]): string {
  return rows.map((row) => row.map(escapeCell).join(",")).join("\r\n") + "\r\n";
}

/** Parses CSV text into rows of cells, honouring quoted cells and doubled quotes. */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const text = input.replace(/^\uFEFF/, "");

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"' && cell.trim() === "") {
      cell = "";
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

export interface ParsedTerm {
  text: string;
  variants: string[];
  categories: string[];
  /** Separate terms that should be grouped with this one. */
  equivalents: string[];
  /** Set when the file names an equivalence group directly. */
  equivalence?: string;
}

/** How commas within a line are read when importing a term list. */
export type CommaMode = "variants" | "terms";

/** A single line of comma-separated words is most likely a plain list of terms. */
export function guessCommaMode(input: string): CommaMode {
  const lines = input.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return lines.length === 1 && lines[0].includes(",") ? "terms" : "variants";
}

const tidyCell = (cell: string) => cell.trim().split(/\s+/).join(" ");

function isNoteRow(row: string[]): boolean {
  const first = row[0]?.trim().toLowerCase() ?? "";
  return (
    first === "note" ||
    first === "notes" ||
    first === "how_to_read_this_file" ||
    first.startsWith("#")
  );
}

/** Rows that can hold a header or a term, with explanation rows removed. */
function termRows(input: string): string[][] {
  return parseCsv(input).filter((row) => row.some((cell) => cell.trim()) && !isNoteRow(row));
}

interface ColumnLayout {
  term: number;
  variants: number[];
  categories: number[];
  equivalents: number[];
  equivalence?: number;
}

const headerName = (cell: string) => tidyCell(cell).toLowerCase().replace(/\s+/g, "_");

/**
 * A header with a terms column. Categories and equivalents are read from columns
 * of those names. A variants column, or any extra column in an older file that
 * has none of those names, still adds variants.
 */
function columnLayout(header: string[]): ColumnLayout | null {
  const names = header.map(headerName);
  const term = names.findIndex((name) => name === "term" || name === "terms");
  if (term === -1) return null;
  const variants: number[] = [];
  const categories: number[] = [];
  const equivalents: number[] = [];
  let equivalence: number | undefined;
  let named = false;
  names.forEach((name, index) => {
    if (index === term) return;
    if (name === "category" || name === "categories") {
      categories.push(index);
      named = true;
    } else if (name === "equivalent" || name === "equivalents") {
      equivalents.push(index);
      named = true;
    } else if (name === "equivalent_group" || name === "equivalence" || name === "equivalence_group") {
      equivalence = index;
      named = true;
    } else if (name === "variant" || name === "variants") {
      variants.push(index);
      named = true;
    }
  });
  if (!named) {
    names.forEach((name, index) => {
      if (index !== term && name !== "") variants.push(index);
    });
  }
  return { term, variants, categories, equivalents, equivalence };
}

/**
 * Optional plural marker attached to a word. `(s)` and `(es)` append that ending
 * beside the unmarked word. `(y/ies)` uses each alternative ending, so
 * `countr(y/ies)` is country and countries.
 */
function expandOptionalPlurals(text: string): string[] {
  const marker = /([\p{L}\p{N}]+)\(([A-Za-z]+(?:\s*\/\s*[A-Za-z]+)*)\)/gu;
  const matches = [...text.matchAll(marker)];
  if (matches.length === 0) return [text];

  type Piece = { kind: "lit"; text: string } | { kind: "opt"; forms: string[] };
  const pieces: Piece[] = [];
  let cursor = 0;
  for (const match of matches) {
    const index = match.index ?? 0;
    const stem = match[1];
    const body = match[2];
    const endings = body.split("/").map((part) => part.trim()).filter(Boolean);
    const forms = body.includes("/") ? endings.map((ending) => stem + ending) : [stem, stem + endings[0]];
    pieces.push({ kind: "lit", text: text.slice(cursor, index) });
    pieces.push({ kind: "opt", forms });
    cursor = index + match[0].length;
  }
  pieces.push({ kind: "lit", text: text.slice(cursor) });

  let results = [""];
  for (const piece of pieces) {
    if (piece.kind === "lit") {
      results = results.map((item) => item + piece.text);
    } else {
      const next: string[] = [];
      for (const item of results) {
        for (const form of piece.forms) next.push(item + form);
      }
      results = next;
    }
  }
  return results;
}

/** Splits a cell on "/" outside parentheses, then expands optional plural endings. */
function splitCellItems(cell: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  for (const char of cell) {
    if (char === "(") depth += 1;
    else if (char === ")" && depth > 0) depth -= 1;
    if (char === "/" && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);

  const items: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    for (const expanded of expandOptionalPlurals(part)) {
      const text = tidyCell(expanded);
      const key = normalizeTerm(text);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      items.push(text);
    }
  }
  return items;
}

/** True when the file uses the template columns instead of a loose comma-separated list. */
export function importUsesColumns(input: string): boolean {
  const rows = termRows(input);
  return rows.length > 0 && columnLayout(rows[0]) !== null;
}

interface ParsedExtras {
  categories?: string[];
  equivalents?: string[];
  equivalence?: string;
}

/**
 * Reads a pasted list or CSV file of terms. The template has columns for terms,
 * categories, and equivalents. Inside a cell, "/" separates items, and an
 * ending such as (s) or (es) is both the singular and the plural. In terms, the
 * first item is the term and the rest are its variants. Without that header,
 * each line holds one term; with mode "variants" further cells on the line are
 * variants of it, and with mode "terms" every cell is a term of its own.
 * Repeats are merged, and the first equivalence group named for a term is kept.
 */
export function parseTermList(input: string, mode: CommaMode): ParsedTerm[] {
  const terms: ParsedTerm[] = [];
  const index = new Map<string, ParsedTerm>();

  const add = (text: string, variants: string[], extra?: ParsedExtras) => {
    const key = normalizeTerm(text);
    let term = index.get(key);
    if (!term) {
      term = { text, variants: [], categories: [], equivalents: [] };
      index.set(key, term);
      terms.push(term);
    }
    if (extra?.equivalence && !term.equivalence) term.equivalence = extra.equivalence;
    for (const variant of variants) {
      const variantKey = normalizeTerm(variant);
      if (!variantKey || index.has(variantKey)) continue;
      index.set(variantKey, term);
      term.variants.push(variant);
    }
    for (const category of extra?.categories ?? []) {
      const categoryKey = normalizeTerm(category);
      if (!categoryKey || term.categories.some((item) => normalizeTerm(item) === categoryKey)) continue;
      term.categories.push(category);
    }
    for (const equivalent of extra?.equivalents ?? []) {
      const equivalentKey = normalizeTerm(equivalent);
      if (!equivalentKey || equivalentKey === normalizeTerm(term.text)) continue;
      if (term.variants.some((variant) => normalizeTerm(variant) === equivalentKey)) continue;
      if (term.equivalents.some((item) => normalizeTerm(item) === equivalentKey)) continue;
      term.equivalents.push(equivalent);
    }
  };

  const rows = termRows(input);
  const layout = rows.length > 0 ? columnLayout(rows[0]) : null;
  rows.forEach((row, rowNumber) => {
    if (layout) {
      if (rowNumber === 0) return;
      const termItems = splitCellItems(row[layout.term] ?? "");
      if (termItems.length === 0) return;
      const variants = [
        ...termItems.slice(1),
        ...layout.variants.flatMap((column) =>
          (row[column] ?? "").split(/[;|]/).flatMap((part) => splitCellItems(part)),
        ),
      ];
      const categories = layout.categories.flatMap((column) => splitCellItems(row[column] ?? ""));
      const equivalents = layout.equivalents.flatMap((column) => splitCellItems(row[column] ?? ""));
      const equivalence =
        layout.equivalence === undefined ? undefined : tidyCell(row[layout.equivalence] ?? "") || undefined;
      add(termItems[0], variants, { categories, equivalents, equivalence });
      return;
    }
    // A loose list still uses commas between entries. "/" and plural endings apply inside each entry.
    if (mode === "terms") {
      for (const cell of row) {
        const items = splitCellItems(cell);
        if (items.length === 0) continue;
        add(items[0], items.slice(1));
      }
      return;
    }
    const cells = row.flatMap((cell, i) =>
      (i === 0 ? [cell] : cell.split(/[;|]/)).flatMap((part) => splitCellItems(part)),
    );
    if (cells.length === 0) return;
    add(cells[0], cells.slice(1));
  });
  return terms;
}

/** Primary terms, plus equivalent terms that are not already terms or variants in the file. */
export function countTermsToImport(terms: ParsedTerm[]): number {
  const covered = new Set<string>();
  for (const term of terms) {
    covered.add(normalizeTerm(term.text));
    for (const variant of term.variants) covered.add(normalizeTerm(variant));
  }
  const extras = new Set<string>();
  for (const term of terms) {
    for (const equivalent of term.equivalents) {
      const key = normalizeTerm(equivalent);
      if (!key || covered.has(key)) continue;
      extras.add(key);
    }
  }
  return terms.length + extras.size;
}

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
  /** Set when the file assigns this term to an equivalence group. */
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
  variants: number[];
  equivalence?: number;
}

/**
 * A header that names term, variants, and optionally an equivalence group.
 * Any other column is read as more variants, so an older two-column file still works.
 */
function columnLayout(header: string[]): ColumnLayout | null {
  const names = header.map((cell) => tidyCell(cell).toLowerCase().replace(/\s+/g, "_"));
  if (names[0] !== "term" && names[0] !== "terms") return null;
  const variants: number[] = [];
  let equivalence: number | undefined;
  names.forEach((name, index) => {
    if (index === 0) return;
    if (name === "equivalent_group" || name === "equivalence" || name === "equivalents" || name === "equivalent") {
      equivalence = index;
    } else if (name === "variant" || name === "variants" || name !== "") {
      variants.push(index);
    }
  });
  return { variants, equivalence };
}

/** True when the file uses the template columns instead of a loose comma-separated list. */
export function importUsesColumns(input: string): boolean {
  const rows = termRows(input);
  return rows.length > 0 && columnLayout(rows[0]) !== null;
}

/**
 * Reads a pasted list or CSV file of terms. A template file has columns for the
 * term, its variants, and an optional equivalence group. Without that header,
 * each line holds one term; with mode "variants" further cells on the line are
 * variants of it, and with mode "terms" every cell is a term of its own.
 * Repeats are merged, and the first equivalence group named for a term is kept.
 */
export function parseTermList(input: string, mode: CommaMode): ParsedTerm[] {
  const terms: ParsedTerm[] = [];
  const index = new Map<string, ParsedTerm>();

  const add = (text: string, variants: string[], equivalence?: string) => {
    const key = normalizeTerm(text);
    let term = index.get(key);
    if (!term) {
      term = { text, variants: [] };
      index.set(key, term);
      terms.push(term);
    }
    if (equivalence && !term.equivalence) term.equivalence = equivalence;
    for (const variant of variants) {
      const variantKey = normalizeTerm(variant);
      if (index.has(variantKey)) continue;
      index.set(variantKey, term);
      term.variants.push(variant);
    }
  };

  const rows = termRows(input);
  const layout = rows.length > 0 ? columnLayout(rows[0]) : null;
  rows.forEach((row, rowNumber) => {
    if (layout) {
      if (rowNumber === 0) return;
      const text = tidyCell(row[0] ?? "");
      if (!text) return;
      const variants = layout.variants.flatMap((index) => (row[index] ?? "").split(/[;|]/)).map(tidyCell).filter(Boolean);
      const equivalence =
        layout.equivalence === undefined ? undefined : tidyCell(row[layout.equivalence] ?? "") || undefined;
      add(text, variants, equivalence);
      return;
    }
    // A variants cell may itself hold several variants separated by ; or |.
    const cells = row
      .flatMap((cell, i) => (i === 0 ? [cell] : cell.split(/[;|]/)))
      .map(tidyCell)
      .filter((cell) => cell.length > 0);
    if (cells.length === 0) return;
    if (mode === "terms") cells.forEach((cell) => add(cell, []));
    else add(cells[0], cells.slice(1));
  });
  return terms;
}

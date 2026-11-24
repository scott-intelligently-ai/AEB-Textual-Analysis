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
}

/** How commas within a line are read when importing a term list. */
export type CommaMode = "variants" | "terms";

/** A single line of comma-separated words is most likely a plain list of terms. */
export function guessCommaMode(input: string): CommaMode {
  const lines = input.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return lines.length === 1 && lines[0].includes(",") ? "terms" : "variants";
}

/**
 * Reads a pasted list or CSV file of terms. Each line holds one term; with
 * mode "variants" further cells on the line are variants of it, and with mode
 * "terms" every cell is a term of its own. A header row starting with "term"
 * is skipped, and repeats are merged.
 */
export function parseTermList(input: string, mode: CommaMode): ParsedTerm[] {
  const tidy = (cell: string) => cell.trim().split(/\s+/).join(" ");
  const terms: ParsedTerm[] = [];
  const index = new Map<string, ParsedTerm>();

  const add = (text: string, variants: string[]) => {
    const key = normalizeTerm(text);
    let term = index.get(key);
    if (!term) {
      term = { text, variants: [] };
      index.set(key, term);
      terms.push(term);
    }
    for (const variant of variants) {
      const variantKey = normalizeTerm(variant);
      if (index.has(variantKey)) continue;
      index.set(variantKey, term);
      term.variants.push(variant);
    }
  };

  parseCsv(input).forEach((row, rowNumber) => {
    // A variants column may itself hold several variants separated by ; or |.
    const cells = row
      .flatMap((cell, i) => (i === 0 ? [cell] : cell.split(/[;|]/)))
      .map(tidy)
      .filter((cell) => cell.length > 0);
    if (cells.length === 0) return;
    if (rowNumber === 0 && /^terms?$/i.test(cells[0])) return;
    if (mode === "terms") cells.forEach((cell) => add(cell, []));
    else add(cells[0], cells.slice(1));
  });
  return terms;
}

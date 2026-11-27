import { Workbook } from "exceljs";
import { formatTermWithVariants } from "./variants";

/** A document that may receive its own worksheet. */
export interface ValenceDocument {
  id: number;
  title: string;
}

/** A term, with the one category assigned to it already written out. */
export interface ValenceTerm {
  id: number;
  text: string;
  variants?: readonly string[];
  /** Empty when the term has no category. A subcategory includes its parent. */
  category: string;
}

/** One appearance of a term or a variant, already attributed to that term. */
export interface ValenceOccurrence {
  documentId: number;
  termId: number;
  /** +1 for a positive tone, 0 for neutral, −1 for negative. */
  score: number;
}

export interface ValenceRow {
  term: string;
  termWithVariants: string;
  category: string;
  valence: number;
}

export interface ValenceSheet {
  documentId: number;
  title: string;
  sheetName: string;
  rows: ValenceRow[];
}

const SHEET_NAME_LIMIT = 31;
const ILLEGAL_SHEET_CHARS = /[:\\/?*[\]]/g;
const HEADERS = ["Term", "Term with variants", "Category", "Valence"] as const;

/**
 * A worksheet name Excel will accept: at most 31 characters, none of : \ / ? * [ ],
 * and unique even when titles differ only by case. "History" is reserved by Excel.
 */
export function excelSheetName(title: string, used: Set<string>): string {
  const cleaned = title
    .replace(ILLEGAL_SHEET_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^'+|'+$/g, "")
    .trim();
  let base = (cleaned || "Document").slice(0, SHEET_NAME_LIMIT).trim() || "Document";
  if (base.toLowerCase() === "history") base = "History sheet";

  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ` (${n})`;
    name = `${base.slice(0, SHEET_NAME_LIMIT - suffix.length).trimEnd()}${suffix}`;
    n += 1;
  }
  used.add(name.toLowerCase());
  return name;
}

/** Empty categories sort after every named one. */
function categoryKey(category: string): string {
  return category.trim() ? category : "\uFFFF";
}

/**
 * One sheet per document that contains at least one term. Rows keep only terms
 * with a positive frequency, sorted by category and then by frequency.
 */
export function valenceSheets(input: {
  documents: readonly ValenceDocument[];
  terms: readonly ValenceTerm[];
  occurrences: readonly ValenceOccurrence[];
}): ValenceSheet[] {
  const known = new Map(input.terms.map((term) => [term.id, term]));
  const totals = new Map<string, { frequency: number; valence: number }>();
  for (const occurrence of input.occurrences) {
    if (!known.has(occurrence.termId)) continue;
    const key = `${occurrence.documentId}:${occurrence.termId}`;
    const current = totals.get(key) ?? { frequency: 0, valence: 0 };
    current.frequency += 1;
    current.valence += occurrence.score;
    totals.set(key, current);
  }

  const used = new Set<string>();
  const sheets: ValenceSheet[] = [];
  for (const document of input.documents) {
    const rows: (ValenceRow & { frequency: number })[] = [];
    for (const term of input.terms) {
      const total = totals.get(`${document.id}:${term.id}`);
      if (!total || total.frequency <= 0) continue;
      rows.push({
        term: term.text,
        termWithVariants: formatTermWithVariants(term.text, term.variants),
        category: term.category,
        valence: total.valence,
        frequency: total.frequency,
      });
    }
    if (rows.length === 0) continue;
    rows.sort((a, b) => {
      const category = categoryKey(a.category).localeCompare(categoryKey(b.category), undefined, {
        numeric: true,
        sensitivity: "base",
      });
      if (category !== 0) return category;
      if (a.frequency !== b.frequency) return b.frequency - a.frequency;
      return a.term.localeCompare(b.term, undefined, { numeric: true, sensitivity: "base" });
    });
    sheets.push({
      documentId: document.id,
      title: document.title,
      sheetName: excelSheetName(document.title, used),
      rows: rows.map((row) => ({
        term: row.term,
        termWithVariants: row.termWithVariants,
        category: row.category,
        valence: row.valence,
      })),
    });
  }
  return sheets;
}

/** An .xlsx file. A library with no matching terms still produces a workbook Excel can open. */
export async function valenceWorkbookBytes(sheets: readonly ValenceSheet[]): Promise<Uint8Array<ArrayBuffer>> {
  const workbook = new Workbook();
  const written =
    sheets.length > 0
      ? sheets
      : [{ documentId: 0, title: "Documents", sheetName: "Documents", rows: [] }];
  for (const sheet of written) {
    const worksheet = workbook.addWorksheet(sheet.sheetName);
    worksheet.addRow([...HEADERS]);
    worksheet.getRow(1).font = { bold: true };
    for (const row of sheet.rows) {
      worksheet.addRow([row.term, row.termWithVariants, row.category, row.valence]);
    }
    worksheet.getColumn(1).width = 28;
    worksheet.getColumn(2).width = 48;
    worksheet.getColumn(3).width = 32;
    worksheet.getColumn(4).width = 12;
  }
  return copyBytes(await workbook.xlsx.writeBuffer());
}

/** A copy whose type is a plain byte array, so it can be a response body. */
function copyBytes(source: ArrayBuffer): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(source.byteLength);
  bytes.set(new Uint8Array(source));
  return bytes;
}

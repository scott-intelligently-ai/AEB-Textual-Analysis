import { Workbook } from "exceljs";
import { formatTermWithVariants } from "./variants";

/** A document whose appearances can be counted. */
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
  frequency: number;
  category: string;
  valence: number;
  document: string;
}

const HEADERS = ["Term", "Term with variants", "Frequency", "Category", "Valence", "Document"] as const;
const SHEET_NAME = "Valence";

/** Empty categories sort after every named one. */
function categoryKey(category: string): string {
  return category.trim() ? category : "\uFFFF";
}

/**
 * One row per term that appears in a document. Sorted by document title, then
 * category, then frequency from highest to lowest.
 */
export function valenceRows(input: {
  documents: readonly ValenceDocument[];
  terms: readonly ValenceTerm[];
  occurrences: readonly ValenceOccurrence[];
}): ValenceRow[] {
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

  const rows: (ValenceRow & { documentId: number })[] = [];
  for (const document of input.documents) {
    for (const term of input.terms) {
      const total = totals.get(`${document.id}:${term.id}`);
      if (!total || total.frequency <= 0) continue;
      rows.push({
        term: term.text,
        termWithVariants: formatTermWithVariants(term.text, term.variants),
        frequency: total.frequency,
        category: term.category,
        valence: total.valence,
        document: document.title,
        documentId: document.id,
      });
    }
  }
  rows.sort((a, b) => {
    const byDocument = a.document.localeCompare(b.document, undefined, {
      numeric: true,
      sensitivity: "base",
    });
    if (byDocument !== 0) return byDocument;
    if (a.documentId !== b.documentId) return a.documentId - b.documentId;
    const category = categoryKey(a.category).localeCompare(categoryKey(b.category), undefined, {
      numeric: true,
      sensitivity: "base",
    });
    if (category !== 0) return category;
    if (a.frequency !== b.frequency) return b.frequency - a.frequency;
    return a.term.localeCompare(b.term, undefined, { numeric: true, sensitivity: "base" });
  });
  return rows.map((row) => ({
    term: row.term,
    termWithVariants: row.termWithVariants,
    frequency: row.frequency,
    category: row.category,
    valence: row.valence,
    document: row.document,
  }));
}

/** An .xlsx file with every document's terms on one sheet. */
export async function valenceWorkbookBytes(rows: readonly ValenceRow[]): Promise<Uint8Array<ArrayBuffer>> {
  const workbook = new Workbook();
  const worksheet = workbook.addWorksheet(SHEET_NAME);
  worksheet.addRow([...HEADERS]);
  worksheet.getRow(1).font = { bold: true };
  for (const row of rows) {
    worksheet.addRow([
      row.term,
      row.termWithVariants,
      row.frequency,
      row.category,
      row.valence,
      row.document,
    ]);
  }
  worksheet.getColumn(1).width = 28;
  worksheet.getColumn(2).width = 48;
  worksheet.getColumn(3).width = 12;
  worksheet.getColumn(4).width = 32;
  worksheet.getColumn(5).width = 12;
  worksheet.getColumn(6).width = 36;
  return copyBytes(await workbook.xlsx.writeBuffer());
}

/** A copy whose type is a plain byte array, so it can be a response body. */
function copyBytes(source: ArrayBuffer): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(source.byteLength);
  bytes.set(new Uint8Array(source));
  return bytes;
}

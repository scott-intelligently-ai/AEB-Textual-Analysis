import { Workbook } from "exceljs";
import { describe, expect, it } from "vitest";
import { findOccurrences } from "./match";
import { valenceRows, valenceWorkbookBytes } from "./valence";

const documents = [
  { id: 2, title: "Speech B" },
  { id: 1, title: "Speech A" },
  { id: 3, title: "Empty speech" },
];

const terms = [
  { id: 10, text: "peace", variants: ["peaceful"], category: "Foreign / Treaties" },
  { id: 11, text: "war", variants: ["wars"], category: "Conflict" },
  { id: 12, text: "tax", category: "Domestic" },
  { id: 13, text: "hope", category: "" },
];

describe("valenceRows", () => {
  it("sums +1, 0, and −1, and counts a variant toward its term", () => {
    const found = findOccurrences("War, wars, and one more war.", [
      { id: 11, text: "war", variants: ["wars"] },
    ]);
    expect(found.map((occurrence) => occurrence.text)).toEqual(["War", "wars", "war"]);

    const rows = valenceRows({
      documents: [{ id: 1, title: "Speech A" }],
      terms: [terms[1]],
      occurrences: found.map((occurrence, index) => ({
        documentId: 1,
        termId: occurrence.termId,
        score: [1, 0, -1][index],
      })),
    });

    expect(rows).toEqual([
      {
        term: "war",
        termWithVariants: "war / wars",
        frequency: 3,
        category: "Conflict",
        valence: 0,
        document: "Speech A",
      },
    ]);
  });

  it("omits a term that never appears, and a document with no terms", () => {
    const rows = valenceRows({
      documents,
      terms,
      occurrences: [{ documentId: 1, termId: 11, score: 1 }],
    });
    expect(rows.map((row) => [row.document, row.term])).toEqual([["Speech A", "war"]]);
  });

  it("sorts by document title, then category, then frequency from highest to lowest", () => {
    const rows = valenceRows({
      documents,
      terms,
      occurrences: [
        { documentId: 2, termId: 12, score: 1 },
        { documentId: 2, termId: 12, score: 1 },
        { documentId: 2, termId: 12, score: 1 },
        { documentId: 2, termId: 11, score: -1 },
        { documentId: 1, termId: 12, score: 1 },
        { documentId: 1, termId: 12, score: 1 },
        { documentId: 1, termId: 12, score: 1 },
        { documentId: 1, termId: 12, score: -1 },
        { documentId: 1, termId: 11, score: -1 },
        { documentId: 1, termId: 11, score: 0 },
        { documentId: 1, termId: 10, score: 1 },
        { documentId: 1, termId: 13, score: 1 },
      ],
    });

    expect(rows.map((row) => [row.document, row.category, row.term, row.frequency, row.valence])).toEqual([
      ["Speech A", "Conflict", "war", 2, -1],
      ["Speech A", "Domestic", "tax", 4, 2],
      ["Speech A", "Foreign / Treaties", "peace", 1, 1],
      ["Speech A", "", "hope", 1, 1],
      ["Speech B", "Conflict", "war", 1, -1],
      ["Speech B", "Domestic", "tax", 3, 3],
    ]);
  });

  it("breaks a frequency tie by the term, within the same category", () => {
    const rows = valenceRows({
      documents: [{ id: 1, title: "Speech A" }],
      terms: [
        { id: 1, text: "gamma", category: "A" },
        { id: 2, text: "epsilon", category: "A" },
        { id: 3, text: "beta", category: "A" },
      ],
      occurrences: [
        { documentId: 1, termId: 1, score: 1 },
        { documentId: 1, termId: 1, score: 1 },
        { documentId: 1, termId: 1, score: 1 },
        { documentId: 1, termId: 2, score: 0 },
        { documentId: 1, termId: 2, score: 0 },
        { documentId: 1, termId: 2, score: 0 },
        { documentId: 1, termId: 3, score: -1 },
      ],
    });
    expect(rows.map((row) => row.term)).toEqual(["epsilon", "gamma", "beta"]);
  });
});

describe("valenceWorkbookBytes", () => {
  it("writes every document onto one sheet, in document order", async () => {
    const rows = valenceRows({
      documents,
      terms,
      occurrences: [
        { documentId: 1, termId: 11, score: -1 },
        { documentId: 2, termId: 10, score: 1 },
        { documentId: 2, termId: 10, score: 1 },
      ],
    });
    const workbook = new Workbook();
    await workbook.xlsx.load((await valenceWorkbookBytes(rows)).buffer);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Valence"]);
    const sheet = workbook.worksheets[0];
    expect(rowValues(sheet, 1)).toEqual([
      "Term",
      "Term with variants",
      "Frequency",
      "Category",
      "Valence",
      "Document",
    ]);
    expect(rowValues(sheet, 2)).toEqual(["war", "war / wars", 1, "Conflict", -1, "Speech A"]);
    expect(rowValues(sheet, 3)).toEqual([
      "peace",
      "peace / peaceful",
      2,
      "Foreign / Treaties",
      2,
      "Speech B",
    ]);
  });

  it("still produces a workbook when nothing matched", async () => {
    const workbook = new Workbook();
    await workbook.xlsx.load((await valenceWorkbookBytes([])).buffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Valence"]);
    expect(rowValues(workbook.worksheets[0], 1)).toEqual([
      "Term",
      "Term with variants",
      "Frequency",
      "Category",
      "Valence",
      "Document",
    ]);
  });
});

function rowValues(sheet: Workbook["worksheets"][number], rowNumber: number): unknown[] {
  const row = sheet.getRow(rowNumber);
  return [1, 2, 3, 4, 5, 6].map((column) => row.getCell(column).value);
}

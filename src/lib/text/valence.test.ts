import { Workbook } from "exceljs";
import { describe, expect, it } from "vitest";
import { findOccurrences } from "./match";
import { excelSheetName, valenceSheets, valenceWorkbookBytes } from "./valence";

const documents = [
  { id: 1, title: "Speech A" },
  { id: 2, title: "Speech B" },
  { id: 3, title: "Empty speech" },
];

const terms = [
  { id: 10, text: "peace", variants: ["peaceful"], category: "Foreign / Treaties" },
  { id: 11, text: "war", variants: ["wars"], category: "Conflict" },
  { id: 12, text: "tax", category: "Domestic" },
  { id: 13, text: "hope", category: "" },
];

describe("valenceSheets", () => {
  it("sums +1, 0, and −1, and counts a variant toward its term", () => {
    const found = findOccurrences("War, wars, and one more war.", [
      { id: 11, text: "war", variants: ["wars"] },
    ]);
    expect(found.map((occurrence) => occurrence.text)).toEqual(["War", "wars", "war"]);

    const sheets = valenceSheets({
      documents: [{ id: 1, title: "Speech A" }],
      terms: [terms[1]],
      occurrences: found.map((occurrence, index) => ({
        documentId: 1,
        termId: occurrence.termId,
        score: [1, 0, -1][index],
      })),
    });

    expect(sheets).toHaveLength(1);
    expect(sheets[0].rows).toEqual([
      {
        term: "war",
        termWithVariants: "war / wars",
        category: "Conflict",
        valence: 0,
      },
    ]);
  });

  it("omits a term that never appears, and a document with no terms", () => {
    const sheets = valenceSheets({
      documents,
      terms,
      occurrences: [{ documentId: 1, termId: 11, score: 1 }],
    });
    expect(sheets.map((sheet) => sheet.title)).toEqual(["Speech A"]);
    expect(sheets[0].rows.map((row) => row.term)).toEqual(["war"]);
  });

  it("sorts by category, then by frequency, and leaves an uncategorized term last", () => {
    const sheets = valenceSheets({
      documents: [{ id: 1, title: "Speech A" }],
      terms,
      occurrences: [
        { documentId: 1, termId: 12, score: 1 },
        { documentId: 1, termId: 12, score: 1 },
        { documentId: 1, termId: 12, score: 1 },
        { documentId: 1, termId: 12, score: -1 },
        { documentId: 1, termId: 11, score: -1 },
        { documentId: 1, termId: 11, score: 0 },
        { documentId: 1, termId: 10, score: 1 },
        { documentId: 1, termId: 13, score: 1 },
        { documentId: 1, termId: 13, score: 1 },
        { documentId: 1, termId: 13, score: 1 },
        { documentId: 1, termId: 13, score: 1 },
        { documentId: 1, termId: 13, score: 1 },
      ],
    });

    expect(sheets[0].rows).toEqual([
      { term: "war", termWithVariants: "war / wars", category: "Conflict", valence: -1 },
      { term: "tax", termWithVariants: "tax", category: "Domestic", valence: 2 },
      {
        term: "peace",
        termWithVariants: "peace / peaceful",
        category: "Foreign / Treaties",
        valence: 1,
      },
      { term: "hope", termWithVariants: "hope", category: "", valence: 5 },
    ]);
  });

  it("breaks a frequency tie by the term, within the same category", () => {
    const sheets = valenceSheets({
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
    expect(sheets[0].rows.map((row) => row.term)).toEqual(["epsilon", "gamma", "beta"]);
  });
});

describe("excelSheetName", () => {
  it("drops characters Excel forbids, shortens the name, and keeps duplicates apart", () => {
    const used = new Set<string>();
    expect(excelSheetName("Report: 2024/Q1?", used)).toBe("Report 2024 Q1");
    expect(excelSheetName("report: 2024/q1?", used)).toBe("report 2024 q1 (2)");
    const long = "A very long document title that will not fit";
    expect(excelSheetName(long, used)).toBe("A very long document title that");
    expect(excelSheetName(long, used)).toBe("A very long document title (2)");
    expect(excelSheetName("History", used)).toBe("History sheet");
  });
});

describe("valenceWorkbookBytes", () => {
  it("writes one worksheet per document, with the four columns", async () => {
    const sheets = valenceSheets({
      documents,
      terms,
      occurrences: [
        { documentId: 1, termId: 11, score: -1 },
        { documentId: 2, termId: 10, score: 1 },
        { documentId: 2, termId: 10, score: 1 },
      ],
    });
    const workbook = new Workbook();
    const bytes = await valenceWorkbookBytes(sheets);
    await workbook.xlsx.load(bytes.buffer);

    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Speech A", "Speech B"]);
    const first = workbook.worksheets[0];
    expect(rowValues(first, 1)).toEqual(["Term", "Term with variants", "Category", "Valence"]);
    expect(rowValues(first, 2)).toEqual(["war", "war / wars", "Conflict", -1]);
    expect(rowValues(workbook.worksheets[1], 2)).toEqual([
      "peace",
      "peace / peaceful",
      "Foreign / Treaties",
      2,
    ]);
  });

  it("still produces a workbook when nothing matched", async () => {
    const workbook = new Workbook();
    const bytes = await valenceWorkbookBytes([]);
    await workbook.xlsx.load(bytes.buffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Documents"]);
    expect(rowValues(workbook.worksheets[0], 1)).toEqual([
      "Term",
      "Term with variants",
      "Category",
      "Valence",
    ]);
  });
});

function rowValues(sheet: Workbook["worksheets"][number], rowNumber: number): unknown[] {
  const row = sheet.getRow(rowNumber);
  return [1, 2, 3, 4].map((column) => row.getCell(column).value);
}

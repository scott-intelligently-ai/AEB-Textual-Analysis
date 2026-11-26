import { describe, expect, it } from "vitest";
import {
  countOccurrences,
  findOccurrences,
  frequencyCountsRows,
  frequencyTable,
  normalizeTerm,
  type TermPattern,
} from "./match";

const term = (
  id: number,
  text: string,
  variants: string[] = [],
  caseSensitive = false,
): TermPattern => ({
  id,
  text,
  variants,
  caseSensitive,
});

const texts = (text: string, terms: TermPattern[]) =>
  findOccurrences(text, terms).map((o) => o.text);

describe("normalizeTerm", () => {
  it("ignores case, surrounding space, and runs of whitespace", () => {
    expect(normalizeTerm("  Free   Trade\n")).toBe("free trade");
  });

  it("treats curly and straight quotes alike", () => {
    expect(normalizeTerm("Workers\u2019 Rights")).toBe("workers' rights");
  });
});

describe("findOccurrences", () => {
  it("matches regardless of case and reports offsets into the original text", () => {
    const text = "Freedom is not free. FREEDOM must be defended.";
    const found = findOccurrences(text, [term(1, "freedom")]);
    expect(found).toEqual([
      { termId: 1, start: 0, end: 7, text: "Freedom" },
      { termId: 1, start: 21, end: 28, text: "FREEDOM" },
    ]);
    for (const o of found) expect(text.slice(o.start, o.end)).toBe(o.text);
  });

  it("matches only the stored capitalization of a case-sensitive term, and any capitalization of its variants", () => {
    const text = "War and war and WAR. Wars, but not wars.";
    expect(texts(text, [term(1, "War", ["Wars"], true)])).toEqual(["War", "Wars", "wars"]);
  });

  it("still matches any whitespace inside a case-sensitive phrase", () => {
    expect(texts("the War  powers", [term(1, "War powers", [], true)])).toEqual(["War  powers"]);
    expect(texts("the war powers", [term(1, "War powers", [], true)])).toEqual([]);
  });

  it("lets a longer case-sensitive phrase win over a shorter case-insensitive term", () => {
    const found = findOccurrences("War powers and war.", [
      term(1, "war"),
      term(2, "War powers", [], true),
    ]);
    expect(found.map((occurrence) => [occurrence.termId, occurrence.text])).toEqual([
      [2, "War powers"],
      [1, "war"],
    ]);
  });

  it("matches whole words only", () => {
    expect(texts("taxes, taxation, syntax and a tax.", [term(1, "tax")])).toEqual([
      "tax",
    ]);
  });

  it("does not treat digits or underscores as word boundaries", () => {
    expect(texts("tax1 _tax tax_ tax", [term(1, "tax")])).toEqual(["tax"]);
  });

  it("treats punctuation and possessives as boundaries", () => {
    expect(
      texts('"Peace," he said; peace-loving peace\u2019s (peace)', [term(1, "peace")]),
    ).toHaveLength(4);
  });

  it("respects boundaries around accented letters", () => {
    expect(texts("La libert\u00e9 et l\u2019\u00e9galit\u00e9; in\u00e9galit\u00e9", [
      term(1, "\u00e9galit\u00e9"),
    ])).toEqual(["\u00e9galit\u00e9"]);
  });

  it("matches phrases across any whitespace, including line breaks", () => {
    const text = "the middle  class, the middle\nclass, the middle\n\nclass";
    expect(texts(text, [term(1, "middle class")])).toHaveLength(3);
  });

  it("matches curly apostrophes against straight ones and the reverse", () => {
    expect(texts("the people\u2019s will, the people's will", [term(1, "people's will")]))
      .toHaveLength(2);
    expect(texts("the people's will", [term(1, "people\u2019s will")])).toHaveLength(1);
  });

  it("escapes regular-expression characters in terms", () => {
    expect(texts("The U.S. and the UXSX", [term(1, "U.S.")])).toEqual(["U.S."]);
    expect(texts("cost (net) and cost net", [term(1, "cost (net)")])).toEqual([
      "cost (net)",
    ]);
  });

  it("counts variants under their term", () => {
    const found = findOccurrences("A tax, two taxes, and taxation.", [
      term(7, "tax", ["taxes", "taxation"]),
    ]);
    expect(found.map((o) => o.termId)).toEqual([7, 7, 7]);
    expect(found.map((o) => o.text)).toEqual(["tax", "taxes", "taxation"]);
  });

  it("prefers the longest term where terms overlap", () => {
    const found = findOccurrences("A tax cut is not a tax.", [
      term(1, "tax"),
      term(2, "tax cut"),
    ]);
    expect(found.map((o) => [o.termId, o.text])).toEqual([
      [2, "tax cut"],
      [1, "tax"],
    ]);
  });

  it("gives a duplicated pattern to the first term that lists it", () => {
    const found = findOccurrences("jobs", [term(1, "jobs"), term(2, "work", ["Jobs"])]);
    expect(found.map((o) => o.termId)).toEqual([1]);
  });

  it("ignores blank terms and returns nothing for an empty list", () => {
    expect(findOccurrences("anything", [])).toEqual([]);
    expect(findOccurrences("anything", [term(1, "   ")])).toEqual([]);
  });
});

describe("countOccurrences", () => {
  it("counts one phrase", () => {
    expect(countOccurrences("Jobs, jobs, and more jobs. Jobless.", "jobs")).toBe(3);
  });
});

describe("frequencyTable", () => {
  const terms = [term(1, "tax", ["taxes"]), term(2, "freedom"), term(3, "liberty")];
  const documents = [
    { id: 10, title: "A", text: "Tax and taxes. Freedom!" },
    { id: 11, title: "B", text: "Freedom, freedom, freedom from tax." },
  ];

  it("counts each term per document with row and column totals", () => {
    const table = frequencyTable(documents, terms);
    expect(table.rows).toEqual([
      { termId: 1, term: "tax", termWithVariants: "tax / taxes", counts: [2, 1], total: 3 },
      { termId: 2, term: "freedom", termWithVariants: "freedom", counts: [1, 3], total: 4 },
      { termId: 3, term: "liberty", termWithVariants: "liberty", counts: [0, 0], total: 0 },
    ]);
    expect(table.documents.map((d) => d.total)).toEqual([3, 4]);
    expect(table.grandTotal).toBe(7);
  });

  it("agrees with the occurrences used for highlighting", () => {
    const table = frequencyTable(documents, terms);
    documents.forEach((document, d) => {
      expect(findOccurrences(document.text, terms)).toHaveLength(
        table.documents[d].total,
      );
    });
  });

  it("puts each term's categories in the counts download", () => {
    const table = frequencyTable(documents, terms);
    table.rows[0].categories = "Economy";
    table.rows[1].categories = "Rights; Speech";
    const rows = frequencyCountsRows(table);
    expect(rows[0]).toEqual(["term", "term_with_variants", "categories", "A", "B", "total"]);
    expect(rows[1]).toEqual(["tax", "tax / taxes", "Economy", 2, 1, 3]);
    expect(rows[2]).toEqual(["freedom", "freedom", "Rights; Speech", 1, 3, 4]);
    expect(rows[4]).toEqual(["total", "", "", 3, 4, 7]);
  });

  it("restricts counts to the documents given", () => {
    const table = frequencyTable([documents[1]], terms);
    expect(table.rows.map((r) => r.total)).toEqual([1, 3, 0]);
  });
});

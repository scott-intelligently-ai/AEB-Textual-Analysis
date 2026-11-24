import { describe, expect, it } from "vitest";
import { buildToneDistribution, type DistributionTone } from "./distribution";

const tones: DistributionTone[] = [
  { id: 1, name: "Negative", sortOrder: 0 },
  { id: 2, name: "Neutral", sortOrder: 1 },
  { id: 3, name: "Positive", sortOrder: 2 },
];

describe("buildToneDistribution", () => {
  const shared = {
    tones,
    terms: [
      { id: 10, text: "peace", equivalenceId: 1 },
      { id: 11, text: "war", equivalenceId: 1 },
      { id: 12, text: "tax", equivalenceId: null },
    ],
    equivalences: [{ id: 1, name: "Conflict" }],
    categories: [
      { id: 1, name: "Foreign", parentId: null },
      { id: 2, name: "Treaties", parentId: 1 },
      { id: 3, name: "Domestic", parentId: null },
    ],
    memberships: [
      { termId: 10, categoryId: 2 },
      { termId: 11, categoryId: 1 },
      { termId: 11, categoryId: 3 },
      { termId: 12, categoryId: 3 },
    ],
    documents: [
      { id: 1, title: "Speech A" },
      { id: 2, title: "Speech B" },
    ],
    occurrences: [
      { documentId: 1, termId: 10, toneId: 3 },
      { documentId: 1, termId: 11, toneId: 1 },
      { documentId: 2, termId: 11, toneId: 1 },
      { documentId: 2, termId: 12, toneId: 2 },
    ],
  };

  it("counts each term on its own", () => {
    const result = buildToneDistribution({ ...shared, group: "term" });
    const peace = result.rows.find((row) => row.label === "peace");
    expect(peace?.counts).toEqual([0, 0, 1]);
    expect(result.rows.find((row) => row.label === "war")?.total).toBe(2);
  });

  it("adds equivalent terms together and leaves the others alone", () => {
    const result = buildToneDistribution({ ...shared, group: "equivalence" });
    expect(result.rows.map((row) => row.label)).toEqual(["Conflict", "tax"]);
    expect(result.rows[0].counts).toEqual([2, 0, 1]);
    expect(result.rows[0].total).toBe(3);
  });

  it("counts a subcategory toward its category, and a term in two categories twice", () => {
    const result = buildToneDistribution({ ...shared, group: "category" });
    const foreign = result.rows.find((row) => row.label === "Foreign");
    const domestic = result.rows.find((row) => row.label === "Domestic");
    expect(foreign?.total).toBe(3);
    expect(domestic?.counts).toEqual([2, 1, 0]);
  });

  it("limits subcategory rows to terms assigned to that subcategory", () => {
    const result = buildToneDistribution({ ...shared, group: "subcategory" });
    expect(result.rows.map((row) => [row.label, row.total])).toEqual([["Foreign / Treaties", 1]]);
  });

  it("groups by document and can be limited to one document", () => {
    const all = buildToneDistribution({ ...shared, group: "document" });
    expect(all.rows.map((row) => [row.label, row.total])).toEqual([
      ["Speech A", 2],
      ["Speech B", 2],
    ]);
    const one = buildToneDistribution({ ...shared, group: "overall", documentIds: [2] });
    expect(one.rows).toEqual([
      { id: "overall", label: "Overall", counts: [1, 1, 0], total: 2 },
    ]);
  });
});

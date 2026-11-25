import { describe, expect, it } from "vitest";
import { documentTermList } from "./documentTerms";

const terms = [
  { id: 1, text: " Freedom ", variants: ["liberty"] },
  { id: 2, text: "war", variants: ["wars"] },
  { id: 3, text: "Peace", variants: [] },
  { id: 4, text: "tax", variants: [] },
];

const counts = new Map([
  [1, 2],
  [2, 5],
  [3, 2],
]);

describe("documentTermList", () => {
  it("keeps only terms that appear, highest count first", () => {
    expect(documentTermList(terms, counts, "", "count").map((term) => term.id)).toEqual([
      2, 1, 3,
    ]);
  });

  it("sorts alphabetically without regard to case", () => {
    expect(documentTermList(terms, counts, "", "alpha").map((term) => term.text.trim())).toEqual([
      "Freedom",
      "Peace",
      "war",
    ]);
  });

  it("matches a search after trimming spaces and ignoring case", () => {
    expect(documentTermList(terms, counts, "  freedom ", "count").map((term) => term.id)).toEqual([
      1,
    ]);
    expect(documentTermList(terms, counts, "WARS", "alpha").map((term) => term.id)).toEqual([2]);
  });

  it("reports an empty list when nothing matches", () => {
    expect(documentTermList(terms, counts, "embargo", "count")).toEqual([]);
  });
});

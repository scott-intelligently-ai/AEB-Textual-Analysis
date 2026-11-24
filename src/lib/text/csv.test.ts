import { describe, expect, it } from "vitest";
import { countTermsToImport, guessCommaMode, importUsesColumns, parseCsv, parseTermList, toCsv } from "./csv";
import { TERM_IMPORT_TEMPLATE } from "./explanations";
import { countUncertain, nextUncertain } from "./transcription";

describe("toCsv and parseCsv", () => {
  it("quotes cells containing commas, quotes, and line breaks, and reads them back", () => {
    const rows = [
      ["term", "context"],
      ["Soviet Union", 'he said "never", twice'],
      ["peace", "line one\nline two"],
    ];
    const csv = toCsv(rows);
    expect(csv).toContain('"he said ""never"", twice"');
    expect(parseCsv(csv.trimEnd())).toEqual(rows);
  });

  it("ignores a byte order mark and accepts either line ending", () => {
    expect(parseCsv("\uFEFFa,b\r\nc,d\ne,f")).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e", "f"],
    ]);
  });
});

const listed = (
  text: string,
  variants: string[] = [],
  extra: { categories?: string[]; equivalents?: string[]; equivalence?: string } = {},
) => ({
  text,
  variants,
  categories: extra.categories ?? [],
  equivalents: extra.equivalents ?? [],
  ...(extra.equivalence ? { equivalence: extra.equivalence } : {}),
});

describe("parseTermList", () => {
  it("reads one term per line with further cells as variants", () => {
    expect(parseTermList("freedom, freedoms, liberty\nSoviet Union\n\npeace", "variants")).toEqual([
      listed("freedom", ["freedoms", "liberty"]),
      listed("Soviet Union"),
      listed("peace"),
    ]);
  });

  it("treats every cell as its own term in terms mode", () => {
    expect(parseTermList("Cuba, missile, peace", "terms")).toEqual([
      listed("Cuba"),
      listed("missile"),
      listed("peace"),
    ]);
  });

  it("skips a header row and splits a variants column on semicolons", () => {
    expect(parseTermList("term,variants\nmissile,missiles; rocket\n", "variants")).toEqual([
      listed("missile", ["missiles", "rocket"]),
    ]);
  });

  it("merges repeats regardless of case and never lists a term as its own variant", () => {
    expect(parseTermList("Tax, taxes\ntax, TAX, levy\nlevy", "variants")).toEqual([
      listed("Tax", ["taxes", "levy"]),
    ]);
  });

  it("collapses stray whitespace inside phrases", () => {
    expect(parseTermList("  Soviet   Union  ", "variants")).toEqual([listed("Soviet Union")]);
  });

  it("reads an older file that names variants and an equivalence group", () => {
    const file = [
      "note,explanation",
      "term,variants,equivalent_group",
      "war,wars,",
      "conflict,,Conflict",
      "peace,,Conflict",
      "freedom,freedoms; liberties,",
    ].join("\n");
    expect(importUsesColumns(file)).toBe(true);
    expect(parseTermList(file, "terms")).toEqual([
      listed("war", ["wars"]),
      listed("conflict", [], { equivalence: "Conflict" }),
      listed("peace", [], { equivalence: "Conflict" }),
      listed("freedom", ["freedoms", "liberties"]),
    ]);
  });

  it("splits terms, categories, and equivalents on slashes and optional plural endings", () => {
    const file = [
      "terms,categories,equivalents",
      "shoe(s) / slippers,footwear / apparel,boot(s)",
      "tax(es),economy,",
      "countr(y/ies),place(s),nation",
      "child(ren) shoe(s),goods,",
    ].join("\n");
    expect(importUsesColumns(file)).toBe(true);
    expect(parseTermList(file, "terms")).toEqual([
      listed("shoe", ["shoes", "slippers"], {
        categories: ["footwear", "apparel"],
        equivalents: ["boot", "boots"],
      }),
      listed("tax", ["taxes"], { categories: ["economy"] }),
      listed("country", ["countries"], {
        categories: ["place", "places"],
        equivalents: ["nation"],
      }),
      listed("child shoe", ["child shoes", "children shoe", "children shoes"], {
        categories: ["goods"],
      }),
    ]);
    expect(countTermsToImport(parseTermList(file, "terms"))).toBe(7);
  });

  it("ignores spaces around the slash and keeps a slash inside parentheses", () => {
    expect(parseTermList("terms\nshoe(s)  /  slippers", "variants")).toEqual([
      listed("shoe", ["shoes", "slippers"]),
    ]);
  });

  it("reads slash-separated variants inside one pasted entry", () => {
    expect(parseTermList("shoe(s) / slippers, boot", "terms")).toEqual([
      listed("shoe", ["shoes", "slippers"]),
      listed("boot"),
    ]);
    expect(parseTermList("shoe(s) / slippers, boot", "variants")).toEqual([
      listed("shoe", ["shoes", "slippers", "boot"]),
    ]);
  });

  it("reads the downloadable template", () => {
    expect(importUsesColumns(TERM_IMPORT_TEMPLATE)).toBe(true);
    expect(parseTermList(TERM_IMPORT_TEMPLATE, "terms")).toEqual([
      listed("war", ["wars"], { categories: ["foreign policy"], equivalents: ["conflict", "conflicts"] }),
      listed("peace", [], { categories: ["foreign policy", "diplomacy"], equivalents: ["armistice"] }),
      listed("tax", ["taxes", "tariff", "tariffs"], { categories: ["economy"], equivalents: ["duty"] }),
      listed("freedom", [], { categories: ["rights"] }),
    ]);
  });
});

describe("guessCommaMode", () => {
  it("reads a single comma-separated line as a list of terms", () => {
    expect(guessCommaMode("Cuba, missile, peace")).toBe("terms");
  });

  it("reads several lines as terms with variants", () => {
    expect(guessCommaMode("freedom, liberty\npeace")).toBe("variants");
    expect(guessCommaMode("peace")).toBe("variants");
  });
});

describe("uncertain reading markers", () => {
  const text = "We shall [?] prevail over [illegible] and [?] again.";

  it("counts both kinds of marker", () => {
    expect(countUncertain(text)).toBe(3);
    expect(countUncertain("Nothing doubtful here.")).toBe(0);
  });

  it("finds the next marker and wraps round to the first", () => {
    const first = nextUncertain(text, 0)!;
    expect(text.slice(first.start, first.end)).toBe("[?]");
    const second = nextUncertain(text, first.end)!;
    expect(text.slice(second.start, second.end)).toBe("[illegible]");
    const third = nextUncertain(text, second.end)!;
    expect(third.start).toBe(text.lastIndexOf("[?]"));
    expect(nextUncertain(text, third.end)).toEqual(first);
    expect(nextUncertain("Nothing doubtful here.", 0)).toBeNull();
  });
});

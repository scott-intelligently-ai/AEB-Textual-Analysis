import { describe, expect, it } from "vitest";
import { guessCommaMode, parseCsv, parseTermList, toCsv } from "./csv";
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

describe("parseTermList", () => {
  it("reads one term per line with further cells as variants", () => {
    expect(parseTermList("freedom, freedoms, liberty\nSoviet Union\n\npeace", "variants")).toEqual([
      { text: "freedom", variants: ["freedoms", "liberty"] },
      { text: "Soviet Union", variants: [] },
      { text: "peace", variants: [] },
    ]);
  });

  it("treats every cell as its own term in terms mode", () => {
    expect(parseTermList("Cuba, missile, peace", "terms")).toEqual([
      { text: "Cuba", variants: [] },
      { text: "missile", variants: [] },
      { text: "peace", variants: [] },
    ]);
  });

  it("skips a header row and splits a variants column on semicolons", () => {
    expect(parseTermList("term,variants\nmissile,missiles; rocket\n", "variants")).toEqual([
      { text: "missile", variants: ["missiles", "rocket"] },
    ]);
  });

  it("merges repeats regardless of case and never lists a term as its own variant", () => {
    expect(parseTermList("Tax, taxes\ntax, TAX, levy\nlevy", "variants")).toEqual([
      { text: "Tax", variants: ["taxes", "levy"] },
    ]);
  });

  it("collapses stray whitespace inside phrases", () => {
    expect(parseTermList("  Soviet   Union  ", "variants")).toEqual([
      { text: "Soviet Union", variants: [] },
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

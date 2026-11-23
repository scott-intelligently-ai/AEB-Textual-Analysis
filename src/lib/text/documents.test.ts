import { describe, expect, it } from "vitest";
import {
  JOINER,
  combineParts,
  editRegion,
  joinPages,
  rebaseSpans,
  splitPart,
  type TermSpan,
} from "./documents";
import { findOccurrences, type TermPattern } from "./match";

const terms: TermPattern[] = [
  { id: 1, text: "tax" },
  { id: 2, text: "freedom" },
];

/** Tags every occurrence so tests can check tags still sit on their words. */
function tag(text: string): TermSpan[] {
  return findOccurrences(text, terms).map(({ termId, start, end }) => ({
    termId,
    start,
    end,
  }));
}

const words = (text: string, spans: TermSpan[]) =>
  spans.map((s) => text.slice(s.start, s.end).toLowerCase());

describe("joinPages", () => {
  it("starts a new paragraph after a page that ends a sentence", () => {
    expect(joinPages(["It is done.", "Now we begin."])).toBe(
      `It is done.${JOINER}Now we begin.`,
    );
    expect(joinPages(["He said \u201cno.\u201d", "Then left."])).toBe(
      `He said \u201cno.\u201d${JOINER}Then left.`,
    );
  });

  it("runs a sentence on across a page turn", () => {
    expect(joinPages(["capable of carrying nuclear weapons,", "are now being uncrated"]))
      .toBe("capable of carrying nuclear weapons, are now being uncrated");
  });

  it("rejoins a word hyphenated across a page turn", () => {
    expect(joinPages(["the Soviet build-", "up on Cuba."])).toBe(
      "the Soviet build-up on Cuba.",
    );
  });

  it("skips blank pages", () => {
    expect(joinPages(["One.", "  ", "Two."])).toBe(`One.${JOINER}Two.`);
  });
});

describe("combineParts", () => {
  it("concatenates in the given order and shifts tags onto the same words", () => {
    const a = "Freedom first.";
    const b = "Then a tax, and freedom.";
    const combined = combineParts([
      { text: a, spans: tag(a) },
      { text: b, spans: tag(b) },
    ]);
    expect(combined.text).toBe(`${a}${JOINER}${b}`);
    expect(words(combined.text, combined.spans)).toEqual(["freedom", "tax", "freedom"]);
    expect(combined.spans).toEqual(tag(combined.text));
  });

  it("honours a different order", () => {
    const a = "Freedom first.";
    const b = "Then a tax.";
    const combined = combineParts([
      { text: b, spans: tag(b) },
      { text: a, spans: tag(a) },
    ]);
    expect(combined.text).toBe(`${b}${JOINER}${a}`);
    expect(words(combined.text, combined.spans)).toEqual(["tax", "freedom"]);
  });

  it("accounts for whitespace trimmed from the edges of each part", () => {
    const a = "\n  Freedom first.  \n";
    const b = "   A tax.";
    const combined = combineParts([
      { text: a, spans: tag(a) },
      { text: b, spans: tag(b) },
    ]);
    expect(combined.text).toBe(`Freedom first.${JOINER}A tax.`);
    expect(combined.spans).toEqual(tag(combined.text));
  });

  it("skips empty parts", () => {
    const combined = combineParts([
      { text: "   ", spans: [] },
      { text: "A tax.", spans: tag("A tax.") },
    ]);
    expect(combined.text).toBe("A tax.");
    expect(combined.spans).toEqual(tag("A tax."));
  });
});

describe("splitPart", () => {
  const text = "Freedom and a tax.\n\nAnother tax, more freedom.";

  it("divides tags between the halves with offsets relative to each half", () => {
    const offset = text.indexOf("Another");
    const { first, second, dropped } = splitPart(text, tag(text), offset);
    expect(first.text).toBe("Freedom and a tax.");
    expect(second.text).toBe("Another tax, more freedom.");
    expect(first.spans).toEqual(tag(first.text));
    expect(second.spans).toEqual(tag(second.text));
    expect(dropped).toEqual([]);
  });

  it("trims whitespace around a cut made in the gap between paragraphs", () => {
    const offset = text.indexOf("\n\n") + 1;
    const { first, second } = splitPart(text, tag(text), offset);
    expect(first.text).toBe("Freedom and a tax.");
    expect(second.text).toBe("Another tax, more freedom.");
    expect(second.spans).toEqual(tag(second.text));
  });

  it("drops a tag that the cut runs through", () => {
    const offset = text.indexOf("tax") + 1;
    const { first, second, dropped } = splitPart(text, tag(text), offset);
    expect(words(text, dropped)).toEqual(["tax"]);
    expect(words(first.text, first.spans)).toEqual(["freedom"]);
    expect(words(second.text, second.spans)).toEqual(["tax", "freedom"]);
  });

  it("is undone by combining the halves", () => {
    const offset = text.indexOf("Another");
    const { first, second } = splitPart(text, tag(text), offset);
    const combined = combineParts([first, second]);
    expect(combined.text).toBe(text);
    expect(combined.spans).toEqual(tag(text));
  });

  it("rejects a cut that would leave an empty half", () => {
    expect(() => splitPart(text, [], 0)).toThrow(RangeError);
    expect(() => splitPart(text, [], text.length)).toThrow(RangeError);
    expect(() => splitPart("word   ", [], 5)).toThrow(RangeError);
    expect(() => splitPart("   word", [], 2)).toThrow(RangeError);
  });
});

describe("editRegion", () => {
  it("finds the replaced region", () => {
    expect(editRegion("a tax here", "a levy here")).toEqual({
      start: 2,
      oldEnd: 5,
      newEnd: 6,
    });
  });

  it("reports an empty region for identical text", () => {
    const region = editRegion("same", "same");
    expect(region.oldEnd).toBe(region.start);
    expect(region.newEnd).toBe(region.start);
  });

  it("handles insertion into repeated characters", () => {
    expect(editRegion("aaa", "aaaa")).toEqual({ start: 3, oldEnd: 3, newEnd: 4 });
  });
});

describe("rebaseSpans", () => {
  const oldText = "Freedom needs a tax. Then freedom needs another tax.";

  it("keeps tags before an edit and shifts tags after it", () => {
    const newText = oldText.replace("needs a tax", "really needs a tax");
    const { kept, dropped } = rebaseSpans(oldText, newText, tag(oldText), terms);
    expect(dropped).toEqual([]);
    expect(kept).toEqual(tag(newText));
  });

  it("drops only the tag inside the edited region", () => {
    const newText = oldText.replace("a tax.", "a levy.");
    const { kept, dropped } = rebaseSpans(oldText, newText, tag(oldText), terms);
    expect(words(oldText, dropped)).toEqual(["tax"]);
    expect(words(newText, kept)).toEqual(["freedom", "freedom", "tax"]);
    expect(kept).toEqual(tag(newText));
  });

  it("drops a tag whose word stops matching after an adjacent edit", () => {
    const newText = oldText.replace("a tax.", "a taxes.");
    const { kept, dropped } = rebaseSpans(oldText, newText, tag(oldText), terms);
    expect(words(oldText, dropped)).toEqual(["tax"]);
    expect(kept).toHaveLength(3);
  });

  it("keeps a tag next to an edit when its word still matches", () => {
    const newText = oldText.replace("a tax.", "a tax!");
    const { kept, dropped } = rebaseSpans(oldText, newText, tag(oldText), terms);
    expect(dropped).toEqual([]);
    expect(kept).toEqual(tag(newText));
  });

  it("drops everything when the whole text is replaced", () => {
    const { kept, dropped } = rebaseSpans(oldText, "Unrelated.", tag(oldText), terms);
    expect(kept).toEqual([]);
    expect(dropped).toHaveLength(4);
  });
});

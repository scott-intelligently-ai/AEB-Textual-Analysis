import { describe, expect, it } from "vitest";
import { findOccurrences } from "../text/match";
import { batchDocuments, splitLongText } from "./suggestTerms";
import { markPassage, planToneRequests } from "./tone";

describe("planToneRequests", () => {
  const paragraph = (n: number) =>
    `Paragraph ${n} speaks of peace at some length. It then turns to war. Finally it returns to peace.`;
  const text = Array.from({ length: 30 }, (_, i) => paragraph(i)).join("\n\n");
  const targets = findOccurrences(text, [
    { id: 1, text: "peace" },
    { id: 2, text: "war" },
  ]);

  it("covers every target exactly once, in order", () => {
    const requests = planToneRequests(text, targets, { maxSpan: 600, maxTargets: 7, context: 150 });
    expect(requests.length).toBeGreaterThan(1);
    expect(requests.flatMap((request) => request.targets)).toEqual(targets);
  });

  it("respects the limits on targets and span, and keeps targets inside their passage", () => {
    const requests = planToneRequests(text, targets, { maxSpan: 600, maxTargets: 7, context: 150 });
    for (const request of requests) {
      const first = request.targets[0];
      const last = request.targets[request.targets.length - 1];
      expect(request.targets.length).toBeLessThanOrEqual(7);
      expect(last.end - first.start).toBeLessThanOrEqual(600);
      expect(request.passageStart).toBeLessThanOrEqual(first.start);
      expect(request.passageEnd).toBeGreaterThanOrEqual(last.end);
    }
  });

  it("starts and ends passages at clean breaks rather than mid-word", () => {
    const requests = planToneRequests(text, targets, { maxSpan: 600, maxTargets: 7, context: 150 });
    for (const request of requests) {
      const before = text[request.passageStart - 1];
      const after = text[request.passageEnd];
      expect(before === undefined || /\s/.test(before)).toBe(true);
      expect(after === undefined || /\s/.test(after)).toBe(true);
    }
  });

  it("uses one request for a short document", () => {
    const short = "We seek peace, not war.";
    const found = findOccurrences(short, [
      { id: 1, text: "peace" },
      { id: 2, text: "war" },
    ]);
    expect(planToneRequests(short, found)).toEqual([
      { passageStart: 0, passageEnd: short.length, targets: found },
    ]);
  });

  it("returns nothing when there is nothing to judge", () => {
    expect(planToneRequests(text, [])).toEqual([]);
  });
});

describe("markPassage", () => {
  it("numbers each target and leaves the rest of the passage untouched", () => {
    const text = "We seek peace, not war. Peace is the goal.";
    const targets = findOccurrences(text, [
      { id: 1, text: "peace" },
      { id: 2, text: "war" },
    ]);
    const [request] = planToneRequests(text, targets);
    const marked = markPassage(text, request);
    expect(marked).toBe(
      'We seek <term n="1">peace</term>, not <term n="2">war</term>. <term n="3">Peace</term> is the goal.',
    );
    expect(marked.replace(/<\/?term[^>]*>/g, "")).toBe(text);
  });
});

describe("batching documents for term discovery", () => {
  it("splits long text at paragraph breaks without losing words", () => {
    const text = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} of the speech.`).join("\n");
    const pieces = splitLongText(text, 300);
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) expect(piece.length).toBeLessThanOrEqual(300);
    expect(pieces.join("\n")).toBe(text);
  });

  it("packs short documents together and labels the parts of a long one", () => {
    const short = { title: "Short", text: "a".repeat(100) };
    const long = { title: "Long", text: Array.from({ length: 30 }, () => "word ".repeat(10)).join("\n") };
    const batches = batchDocuments([short, short, long], 500);
    for (const batch of batches) {
      const size = batch.reduce((sum, document) => sum + document.text.length, 0);
      expect(size).toBeLessThanOrEqual(500);
    }
    expect(batches[0].map((document) => document.title)).toEqual(["Short", "Short"]);
    const titles = batches.flat().map((document) => document.title);
    expect(titles.some((title) => /^Long \(part 1 of \d+\)$/.test(title))).toBe(true);
  });
});

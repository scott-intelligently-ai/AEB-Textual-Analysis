import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The services open the database on first use, so the data directory must be
// set before they are imported.
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "speech-test-"));
process.env.DATA_DIR = dataDir;

type Services = {
  db: typeof import("../db");
  documents: typeof import("./documents");
  terms: typeof import("./terms");
  tones: typeof import("./tones");
  annotations: typeof import("./annotations");
  frequency: typeof import("./frequency");
  suggestions: typeof import("./suggestions");
};
let s: Services;

beforeAll(async () => {
  s = {
    db: await import("../db"),
    documents: await import("./documents"),
    terms: await import("./terms"),
    tones: await import("./tones"),
    annotations: await import("./annotations"),
    frequency: await import("./frequency"),
    suggestions: await import("./suggestions"),
  };
});

afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

function addDocument(title: string, text: string): number {
  const { getDb, schema } = s.db;
  return getDb()
    .insert(schema.documents)
    .values({ title, text, sourcePageIds: [] })
    .returning({ id: schema.documents.id })
    .get().id;
}

function toneId(name: string): number {
  return s.tones.listTones().find((tone) => tone.name === name)!.id;
}

/** Tags the nth occurrence of a word in a document and returns its span. */
function tag(documentId: number, word: string, nth: number, tone: string) {
  const text = s.documents.getDocumentRow(documentId).text;
  let start = -1;
  for (let i = 0; i <= nth; i += 1) start = text.indexOf(word, start + 1);
  const span = { start, end: start + word.length };
  s.annotations.setTone(documentId, span, toneId(tone));
  return span;
}

/** The words each tone tag sits on, in order, as "word=Tone". */
function tagged(documentId: number): string[] {
  const text = s.documents.getDocumentRow(documentId).text;
  const names = new Map(s.tones.listTones().map((tone) => [tone.id, tone.name]));
  return s.annotations
    .listAnnotations(documentId)
    .sort((a, b) => a.start - b.start)
    .map((a) => `${text.slice(a.start, a.end)}=${names.get(a.toneId)}`);
}

describe("services", () => {
  it("seeds the five default tones with Neutral as the default", () => {
    const tones = s.tones.listTones();
    expect(tones.map((tone) => tone.name)).toEqual([
      "Very negative",
      "Negative",
      "Neutral",
      "Positive",
      "Very positive",
    ]);
    expect(tones.filter((tone) => tone.isDefault).map((tone) => tone.name)).toEqual(["Neutral"]);
  });

  it("rejects a term whose wording is already taken", () => {
    s.terms.createTerm({ text: "peace" });
    s.terms.createTerm({ text: "war", variants: ["wars"] });
    s.terms.createTerm({ text: "tax" });
    expect(() => s.terms.createTerm({ text: "Peace" })).toThrow(/already on the term list/);
    expect(() => s.terms.createTerm({ text: "wars" })).toThrow(/already covered by the term "war"/);
    const result = s.terms.importTerms([{ text: "freedom" }, { text: "WAR" }]);
    expect(result.added.map((term) => term.text)).toEqual(["freedom"]);
    expect(result.skipped).toHaveLength(1);
  });

  it("only accepts a tone on a real occurrence of a term", () => {
    const id = addDocument("Check", "We want peace.");
    expect(() => s.annotations.setTone(id, { start: 0, end: 2 }, toneId("Positive"))).toThrow(
      /no longer an occurrence/,
    );
    s.documents.deleteDocument(id);
  });

  it("carries tone tags through combine, split, and edit", () => {
    const a = addDocument("Part A", "We want peace. We reject war.");
    const b = addDocument("Part B", "  The wars must end, and peace must follow.  ");
    tag(a, "peace", 0, "Positive");
    tag(a, "war", 0, "Very negative");
    tag(b, "wars", 0, "Negative");
    tag(b, "peace", 0, "Very positive");

    const combined = s.documents.combineDocuments([a, b], "Whole speech").id;
    expect(s.documents.listDocuments().map((d) => d.title)).toEqual(["Whole speech"]);
    expect(s.documents.getDocumentRow(combined).text).toBe(
      "We want peace. We reject war.\n\nThe wars must end, and peace must follow.",
    );
    expect(tagged(combined)).toEqual([
      "peace=Positive",
      "war=Very negative",
      "wars=Negative",
      "peace=Very positive",
    ]);

    // Editing before the tags shifts them; editing a tagged word clears only that tag.
    const text = s.documents.getDocumentRow(combined).text;
    expect(s.documents.updateDocumentText(combined, `Tonight: ${text}`)).toEqual({ cleared: 0 });
    expect(tagged(combined)).toHaveLength(4);
    const edited = s.documents.getDocumentRow(combined).text.replace("reject war", "reject conflict");
    expect(s.documents.updateDocumentText(combined, edited)).toEqual({ cleared: 1 });
    expect(tagged(combined)).toEqual(["peace=Positive", "wars=Negative", "peace=Very positive"]);

    const offset = s.documents.getDocumentRow(combined).text.indexOf("The wars");
    const split = s.documents.splitDocument(combined, offset, { second: "Second half" });
    expect(split.cleared).toBe(0);
    expect(s.documents.getDocumentRow(split.first).title).toBe("Whole speech (part 1)");
    expect(s.documents.getDocumentRow(split.second).text).toBe(
      "The wars must end, and peace must follow.",
    );
    expect(tagged(split.first)).toEqual(["peace=Positive"]);
    expect(tagged(split.second)).toEqual(["wars=Negative", "peace=Very positive"]);
  });

  it("counts terms in all documents or only the selected ones", () => {
    const [first, second] = s.documents.listDocuments();
    const all = s.frequency.getFrequency();
    const row = (table: typeof all, term: string) => table.rows.find((r) => r.term === term)!;
    expect(row(all, "peace").total).toBe(2);
    expect(row(all, "war").total).toBe(1);
    expect(all.grandTotal).toBe(3);

    const one = s.frequency.getFrequency([second.id]);
    expect(one.documents.map((d) => d.id)).toEqual([second.id]);
    expect(one.grandTotal + s.frequency.getFrequency([first.id]).grandTotal).toBe(all.grandTotal);
  });

  it("exports every occurrence with its tone, using the default when none is set", () => {
    const id = addDocument("Untagged", "Peace, peace, and no war.");
    tag(id, "war", 0, "Negative");
    const lines = s.frequency.occurrencesCsv([id]).trim().split("\r\n");
    expect(lines[0]).toBe("document,term,matched_text,position,tone,tone_score,tone_set_by,context");
    expect(lines.slice(1).map((line) => line.split(",").slice(1, 7).join(","))).toEqual([
      "peace,Peace,0,Neutral,0,default",
      "peace,peace,7,Neutral,0,default",
      "war,war,21,Negative,-1,user",
    ]);
    s.documents.deleteDocument(id);
  });

  it("drops tags that stop matching when the term list changes", () => {
    const id = addDocument("Budget", "A tax cut is not a tax rise.");
    tag(id, "tax", 0, "Positive");
    tag(id, "tax", 1, "Negative");
    // "tax cut" now owns the first two words, so the tag on that "tax" is stale.
    s.terms.createTerm({ text: "tax cut" });
    expect(tagged(id)).toEqual(["tax=Negative"]);
    s.documents.deleteDocument(id);
  });

  it("returns occurrences to the default when their tone is deleted", () => {
    const id = addDocument("Tone", "Lasting peace.");
    const mixed = s.tones.createTone({ name: "Mixed", color: "#7c3aed" });
    const span = tag(id, "peace", 0, "Mixed");
    expect(s.tones.listTonesWithUsage().find((tone) => tone.id === mixed.id)!.usage).toBe(1);
    s.tones.deleteTone(mixed.id);
    expect(s.annotations.listAnnotations(id)).toEqual([]);
    expect(() => s.tones.deleteTone(toneId("Neutral"))).toThrow(/default tone cannot be deleted/);
    expect(() => s.annotations.setTone(id, span, mixed.id)).toThrow(/no longer exists/);
    s.documents.deleteDocument(id);
  });

  it("confirms or discards AI suggestions without touching the user's tags", () => {
    const { getDb, schema } = s.db;
    const id = addDocument("Suggestions", "Peace now. Peace always. No war.");
    const mine = tag(id, "Peace", 0, "Positive");
    const peace = s.terms.listTerms().find((term) => term.text === "peace")!.id;
    getDb()
      .insert(schema.annotations)
      .values({
        documentId: id,
        termId: peace,
        start: 11,
        end: 16,
        toneId: toneId("Very positive"),
        source: "ai",
        reason: "Emphatic repetition.",
      })
      .run();

    expect(s.annotations.discardSuggestions(id)).toEqual({ discarded: 1 });
    expect(s.annotations.listAnnotations(id).map((a) => a.start)).toEqual([mine.start]);

    getDb()
      .insert(schema.annotations)
      .values({ documentId: id, termId: peace, start: 11, end: 16, toneId: toneId("Negative"), source: "ai" })
      .run();
    expect(s.annotations.confirmSuggestions(id)).toEqual({ confirmed: 1 });
    expect(s.annotations.listAnnotations(id).every((a) => a.source === "user")).toBe(true);
    s.documents.deleteDocument(id);
  });

  it("accepting a suggested term adds it once and stops highlighting it everywhere", () => {
    const { getDb, schema } = s.db;
    const one = addDocument("One", "The blockade holds. The quarantine holds.");
    const two = addDocument("Two", "A blockade is an act of war.");
    const insert = (text: string) =>
      getDb()
        .insert(schema.termSuggestions)
        .values({ text, normalized: text.toLowerCase(), rationale: "Central to the crisis." })
        .returning({ id: schema.termSuggestions.id })
        .get().id;
    const blockade = insert("blockade");
    const quarantine = insert("quarantine");

    const before = s.suggestions.listSuggestions();
    expect(before.pending.map((p) => [p.text, p.total])).toEqual([
      ["blockade", 2],
      ["quarantine", 1],
    ]);
    expect(before.pending[0].perDocument).toEqual({ [one]: 1, [two]: 1 });

    s.suggestions.decideSuggestion(blockade, "accepted");
    expect(s.terms.listTerms().filter((term) => term.text === "blockade")).toHaveLength(1);
    expect(s.suggestions.listSuggestions().pending.map((p) => p.text)).toEqual(["quarantine"]);
    expect(() => s.suggestions.decideSuggestion(blockade, "rejected")).toThrow(/already on the term list/);

    s.suggestions.decideSuggestion(quarantine, "rejected");
    expect(s.suggestions.listSuggestions()).toEqual({
      pending: [],
      rejected: [{ id: quarantine, text: "quarantine" }],
    });
    expect(s.terms.listTerms().some((term) => term.text === "quarantine")).toBe(false);

    s.suggestions.decideSuggestion(quarantine, "pending");
    expect(s.suggestions.listSuggestions().pending.map((p) => p.text)).toEqual(["quarantine"]);
  });
});

import { readFileSync } from "node:fs";
import { asc, eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

type Services = {
  db: typeof import("../db");
  documents: typeof import("./documents");
  terms: typeof import("./terms");
  tones: typeof import("./tones");
  annotations: typeof import("./annotations");
  frequency: typeof import("./frequency");
  suggestions: typeof import("./suggestions");
  taxonomy: typeof import("./taxonomy");
  distribution: typeof import("./distribution");
};
let s: Services;

beforeAll(async () => {
  const { installTestDatabase } = await import("../db/test-db");
  await installTestDatabase();
  s = {
    db: await import("../db"),
    documents: await import("./documents"),
    terms: await import("./terms"),
    tones: await import("./tones"),
    annotations: await import("./annotations"),
    frequency: await import("./frequency"),
    suggestions: await import("./suggestions"),
    taxonomy: await import("./taxonomy"),
    distribution: await import("./distribution"),
  };
});

async function addDocument(title: string, text: string): Promise<number> {
  const { getDb, schema } = s.db;
  const db = await getDb();
  const [row] = await db
    .insert(schema.documents)
    .values({ title, text, sourcePageIds: [] })
    .returning({ id: schema.documents.id });
  return row.id;
}

async function toneId(name: string): Promise<number> {
  return (await s.tones.listTones()).find((tone) => tone.name === name)!.id;
}

/** Tags the nth occurrence of a word in a document and returns its span. */
async function tag(documentId: number, word: string, nth: number, tone: string) {
  const text = (await s.documents.getDocumentRow(documentId)).text;
  let start = -1;
  for (let i = 0; i <= nth; i += 1) start = text.indexOf(word, start + 1);
  const span = { start, end: start + word.length };
  await s.annotations.setTone(documentId, span, await toneId(tone));
  return span;
}

/** The words each tone tag sits on, in order, as "word=Tone". */
async function tagged(documentId: number): Promise<string[]> {
  const text = (await s.documents.getDocumentRow(documentId)).text;
  const names = new Map((await s.tones.listTones()).map((tone) => [tone.id, tone.name]));
  return (await s.annotations.listAnnotations(documentId))
    .sort((a, b) => a.start - b.start)
    .map((annotation) => `${text.slice(annotation.start, annotation.end)}=${names.get(annotation.toneId)}`);
}

describe("services", () => {
  it("seeds positive, neutral, and negative, with Neutral as the default", async () => {
    const tones = await s.tones.listTones();
    expect(tones.map((tone) => [tone.name, tone.score, tone.definition])).toEqual(
      s.db.DEFAULT_TONES.map((tone) => [tone.name, tone.score, tone.definition]),
    );
    expect(tones.filter((tone) => tone.isDefault).map((tone) => tone.name)).toEqual(["Neutral"]);
    const migration = readFileSync("drizzle/0003_default_tone_definitions.sql", "utf8");
    for (const tone of tones) {
      expect(tone.definition!.length).toBeLessThanOrEqual(s.tones.TONE_DEFINITION_MAX);
      expect(migration).toContain(tone.definition);
    }
  });

  it("replaces an untouched set of the old five tones and keeps their tags", async () => {
    const { getDb, schema, seed } = s.db;
    const db = await getDb();
    await db.delete(schema.tones);
    await db.insert(schema.tones).values([
      { name: "Very negative", color: "#b91c1c", score: -2, isDefault: false, sortOrder: 0 },
      { name: "Negative", color: "#ea580c", score: -1, isDefault: false, sortOrder: 1 },
      { name: "Neutral", color: "#52525b", score: 0, isDefault: true, sortOrder: 2 },
      { name: "Positive", color: "#16a34a", score: 1, isDefault: false, sortOrder: 3 },
      { name: "Very positive", color: "#047857", score: 2, isDefault: false, sortOrder: 4 },
    ]);
    await db
      .update(schema.tones)
      .set({ definition: "Kept." })
      .where(eq(schema.tones.name, "Neutral"));
    const before = await s.tones.listTones();
    const veryPositive = before.find((tone) => tone.name === "Very positive")!;
    const veryNegative = before.find((tone) => tone.name === "Very negative")!;
    const positiveId = before.find((tone) => tone.name === "Positive")!.id;
    const negativeId = before.find((tone) => tone.name === "Negative")!.id;
    const documentId = await addDocument("Legacy tones", "Peace and war.");
    const [term] = await db
      .insert(schema.terms)
      .values({ text: "legacycheck" })
      .returning({ id: schema.terms.id });
    await db.insert(schema.annotations).values([
      {
        documentId,
        termId: term.id,
        start: 0,
        end: 5,
        toneId: veryPositive.id,
        source: "user",
      },
      {
        documentId,
        termId: term.id,
        start: 10,
        end: 13,
        toneId: veryNegative.id,
        source: "user",
      },
    ]);

    await seed(db);

    const tones = await s.tones.listTones();
    expect(tones.map((tone) => tone.name)).toEqual(["Positive", "Neutral", "Negative"]);
    expect(tones.find((tone) => tone.isDefault)?.name).toBe("Neutral");
    expect(tones.find((tone) => tone.name === "Neutral")?.definition).toBe("Kept.");
    expect(tones.find((tone) => tone.name === "Positive")?.definition).toBe(
      s.db.DEFAULT_TONES.find((tone) => tone.name === "Positive")?.definition,
    );
    expect(tones.find((tone) => tone.name === "Negative")?.definition).toBe(
      s.db.DEFAULT_TONES.find((tone) => tone.name === "Negative")?.definition,
    );
    const tags = await db
      .select({ toneId: schema.annotations.toneId })
      .from(schema.annotations)
      .orderBy(asc(schema.annotations.start));
    expect(tags.map((tag) => tag.toneId)).toEqual([positiveId, negativeId]);

    await db.delete(schema.documents).where(eq(schema.documents.id, documentId));
    await db.delete(schema.terms).where(eq(schema.terms.id, term.id));
  });

  it("leaves a tone list alone once someone has added to the original five", async () => {
    const { getDb, schema, seed } = s.db;
    const db = await getDb();
    await db.delete(schema.tones);
    await db.insert(schema.tones).values([
      { name: "Very negative", color: "#b91c1c", score: -2, isDefault: false, sortOrder: 0 },
      { name: "Negative", color: "#ea580c", score: -1, isDefault: false, sortOrder: 1 },
      { name: "Neutral", color: "#52525b", score: 0, isDefault: true, sortOrder: 2 },
      { name: "Positive", color: "#16a34a", score: 1, isDefault: false, sortOrder: 3 },
      { name: "Very positive", color: "#047857", score: 2, isDefault: false, sortOrder: 4 },
      { name: "Mixed", color: "#7c3aed", score: 0, isDefault: false, sortOrder: 5 },
    ]);
    await seed(db);
    const leftAlone = await s.tones.listTones();
    expect(leftAlone.map((tone) => tone.name)).toEqual([
      "Very negative",
      "Negative",
      "Neutral",
      "Positive",
      "Very positive",
      "Mixed",
    ]);
    expect(leftAlone.find((tone) => tone.name === "Positive")?.definition ?? null).toBeNull();
    await db.delete(schema.tones);
    await seed(db);
    expect((await s.tones.listTones()).map((tone) => tone.name)).toEqual([
      "Positive",
      "Neutral",
      "Negative",
    ]);
  });

  it("stores a tone definition and clears it when the field is emptied", async () => {
    const id = await toneId("Positive");
    const saved = await s.tones.updateTone(id, {
      definition: "  Approval of what the term refers to.  ",
    });
    expect(saved.definition).toBe("Approval of what the term refers to.");
    const cleared = await s.tones.updateTone(id, { definition: "   " });
    expect(cleared.definition).toBeNull();
    await s.db.seed(await s.db.getDb());
    expect((await s.tones.listTones()).find((tone) => tone.id === id)?.definition).toBeNull();
  });

  it("rejects a term whose wording is already taken", async () => {
    await s.terms.createTerm({ text: "peace" });
    await s.terms.createTerm({ text: "war", variants: ["wars"] });
    await s.terms.createTerm({ text: "tax" });
    await expect(s.terms.createTerm({ text: "Peace" })).rejects.toThrow(/already on the term list/);
    await expect(s.terms.createTerm({ text: "wars" })).rejects.toThrow(/already covered by the term "war"/);
    const nato = await s.terms.createTerm({ text: "Nato", variants: ["allies"], caseSensitive: true });
    const cased = await addDocument("Capitals", "Nato, nato, NATO, and Allies.");
    expect((await s.frequency.getFrequency([cased])).rows.find((row) => row.term === "Nato")?.total).toBe(2);
    await s.terms.updateTerm(nato.id, { text: "Nato", variants: ["allies"], caseSensitive: false });
    expect((await s.frequency.getFrequency([cased])).rows.find((row) => row.term === "Nato")?.total).toBe(4);
    await s.documents.deleteDocument(cased);
    await s.terms.deleteTerm(nato.id);
    const result = await s.terms.importTerms([{ text: "freedom" }, { text: "WAR" }]);
    expect(result.added.map((term) => term.text)).toEqual(["freedom"]);
    expect(result.skipped).toHaveLength(1);
  });

  it("only accepts a tone on a real occurrence of a term", async () => {
    const id = await addDocument("Check", "We want peace.");
    await expect(
      s.annotations.setTone(id, { start: 0, end: 2 }, await toneId("Positive")),
    ).rejects.toThrow(/no longer an occurrence/);
    await s.documents.deleteDocument(id);
  });

  it("carries tone tags through combine, split, and edit", async () => {
    const a = await addDocument("Part A", "We want peace. We reject war.");
    const b = await addDocument("Part B", "  The wars must end, and peace must follow.  ");
    await tag(a, "peace", 0, "Positive");
    await tag(a, "war", 0, "Negative");
    await tag(b, "wars", 0, "Neutral");
    await tag(b, "peace", 0, "Positive");

    const combined = (await s.documents.combineDocuments([a, b], "Whole speech")).id;
    expect((await s.documents.listDocuments()).map((document) => document.title)).toEqual([
      "Whole speech",
    ]);
    expect((await s.documents.getDocumentRow(combined)).text).toBe(
      "We want peace. We reject war.\n\nThe wars must end, and peace must follow.",
    );
    expect(await tagged(combined)).toEqual([
      "peace=Positive",
      "war=Negative",
      "wars=Neutral",
      "peace=Positive",
    ]);

    const text = (await s.documents.getDocumentRow(combined)).text;
    expect(await s.documents.updateDocumentText(combined, `Tonight: ${text}`)).toEqual({
      cleared: 0,
    });
    expect(await tagged(combined)).toHaveLength(4);
    const edited = (await s.documents.getDocumentRow(combined)).text.replace(
      "reject war",
      "reject conflict",
    );
    expect(await s.documents.updateDocumentText(combined, edited)).toEqual({ cleared: 1 });
    expect(await tagged(combined)).toEqual([
      "peace=Positive",
      "wars=Neutral",
      "peace=Positive",
    ]);

    const offset = (await s.documents.getDocumentRow(combined)).text.indexOf("The wars");
    const split = await s.documents.splitDocument(combined, offset, { second: "Second half" });
    expect(split.cleared).toBe(0);
    expect((await s.documents.getDocumentRow(split.first)).title).toBe("Whole speech (part 1)");
    expect((await s.documents.getDocumentRow(split.second)).text).toBe(
      "The wars must end, and peace must follow.",
    );
    expect(await tagged(split.first)).toEqual(["peace=Positive"]);
    expect(await tagged(split.second)).toEqual(["wars=Neutral", "peace=Positive"]);
  });

  it("counts terms in all documents or only the selected ones", async () => {
    const [first, second] = await s.documents.listDocuments();
    const all = await s.frequency.getFrequency();
    const row = (table: typeof all, term: string) => table.rows.find((entry) => entry.term === term)!;
    expect(row(all, "peace").total).toBe(2);
    expect(row(all, "war").total).toBe(1);
    expect(all.grandTotal).toBe(3);

    const one = await s.frequency.getFrequency([second.id]);
    expect(one.documents.map((document) => document.id)).toEqual([second.id]);
    expect(one.grandTotal + (await s.frequency.getFrequency([first.id])).grandTotal).toBe(
      all.grandTotal,
    );
  });

  it("exports every occurrence with its tone, using the default when none is set", async () => {
    const id = await addDocument("Untagged", "Peace, peace, and no war.");
    await tag(id, "war", 0, "Negative");
    const lines = (await s.frequency.occurrencesCsv([id])).trim().split("\r\n");
    expect(lines[0].startsWith("how_to_read_this_file,")).toBe(true);
    expect(lines[1]).toBe(
      "document,term,categories,matched_text,position,tone,tone_score,tone_set_by,context",
    );
    expect(lines.slice(2).map((line) => line.split(",").slice(1, 8).join(","))).toEqual([
      "peace,,Peace,0,Neutral,0,default",
      "peace,,peace,7,Neutral,0,default",
      "war,,war,21,Negative,-1,user",
    ]);
    await s.documents.deleteDocument(id);
  });

  it("counts an unconfirmed Jev suggestion as that tone in a download", async () => {
    const { getDb, schema } = s.db;
    const id = await addDocument("Jev export", "Peace now.");
    const peace = (await s.terms.listTerms()).find((term) => term.text === "peace")!;
    await (await getDb()).insert(schema.annotations).values({
      documentId: id,
      termId: peace.id,
      start: 0,
      end: 5,
      toneId: await toneId("Negative"),
      source: "ai",
      reason: "A warning.",
    });
    const occurrence = (await s.frequency.occurrencesCsv([id])).trim().split("\r\n")[2].split(",");
    expect(occurrence[5]).toBe("Negative");
    expect(occurrence[7]).toBe("user");
    const frequency = (await s.frequency.toneFrequencyCsv([id])).trim().split("\r\n");
    const header = frequency[1].split(",");
    const row = frequency.find((line) => line.startsWith("Jev export,peace,"))!.split(",");
    expect(row[header.indexOf("Negative")]).toBe("1");
    expect(row[header.indexOf("Neutral")]).toBe("0");
    await s.documents.deleteDocument(id);
  });

  it("asks Jev about every document when that scope is chosen", async () => {
    const first = await addDocument("Jev scope one", "Peace.");
    const second = await addDocument("Jev scope two", "War.");
    const ids = (await s.documents.listDocuments()).map((document) => document.id);
    const seen: number[] = [];
    const result = await s.annotations.suggestAllDocumentTones(async (documentId) => {
      seen.push(documentId);
      return { suggested: 1, skipped: 2, missed: 3 };
    });
    expect(seen).toEqual(ids);
    expect(result).toEqual({
      suggested: ids.length,
      skipped: ids.length * 2,
      missed: ids.length * 3,
      documents: ids.length,
    });
    await s.documents.deleteDocument(first);
    await s.documents.deleteDocument(second);
  });

  it("exports one count per tone, plus a total, for each term in each document", async () => {
    const first = await addDocument("Tone counts", "Peace, peace, and wars.");
    const second = await addDocument("Tone counts again", "No peace here.");
    await tag(first, "Peace", 0, "Positive");
    await tag(first, "wars", 0, "Negative");
    const tones = (await s.tones.listTones()).map((tone) => tone.name);
    const lines = (await s.frequency.toneFrequencyCsv([first, second])).trim().split("\r\n");
    expect(lines[0].startsWith("how_to_read_this_file,")).toBe(true);
    expect(lines[1]).toBe(["document", "term", "categories", ...tones, "total"].join(","));
    const row = (document: string, term: string) =>
      lines.find((line) => line.startsWith(`${document},${term},`));
    const numbers = (line: string | undefined) => line?.split(",").slice(3);
    expect(numbers(row("Tone counts", "peace"))).toEqual(["1", "1", "0", "2"]);
    expect(numbers(row("Tone counts", "war"))).toEqual(["0", "0", "1", "1"]);
    expect(numbers(row("Tone counts again", "peace"))).toEqual(["0", "1", "0", "1"]);
    expect(numbers(row("Tone counts again", "war"))).toEqual(["0", "0", "0", "0"]);
    await s.documents.deleteDocument(first);
    await s.documents.deleteDocument(second);
  });

  it("drops tags that stop matching when the term list changes", async () => {
    const id = await addDocument("Budget", "A tax cut is not a tax rise.");
    await tag(id, "tax", 0, "Positive");
    await tag(id, "tax", 1, "Negative");
    await s.terms.createTerm({ text: "tax cut" });
    expect(await tagged(id)).toEqual(["tax=Negative"]);
    await s.documents.deleteDocument(id);
  });

  it("returns occurrences to the default when their tone is deleted", async () => {
    const id = await addDocument("Tone", "Lasting peace.");
    const mixed = await s.tones.createTone({ name: "Mixed", color: "#7c3aed" });
    const span = await tag(id, "peace", 0, "Mixed");
    expect(
      (await s.tones.listTonesWithUsage()).find((tone) => tone.id === mixed.id)!.usage,
    ).toBe(1);
    await s.tones.deleteTone(mixed.id);
    expect(await s.annotations.listAnnotations(id)).toEqual([]);
    await expect(s.tones.deleteTone(await toneId("Neutral"))).rejects.toThrow(
      /default tone cannot be deleted/,
    );
    await expect(s.annotations.setTone(id, span, mixed.id)).rejects.toThrow(/no longer exists/);
    await s.documents.deleteDocument(id);
  });

  it("confirms or discards AI suggestions without touching the user's tags", async () => {
    const { getDb, schema } = s.db;
    const id = await addDocument("Suggestions", "Peace now. Peace always. No war.");
    const mine = await tag(id, "Peace", 0, "Positive");
    const peace = (await s.terms.listTerms()).find((term) => term.text === "peace")!.id;
    const db = await getDb();
    await db.insert(schema.annotations).values({
      documentId: id,
      termId: peace,
      start: 11,
      end: 16,
      toneId: await toneId("Neutral"),
      source: "ai",
      reason: "Emphatic repetition.",
    });

    expect(await s.annotations.discardSuggestions(id)).toEqual({ discarded: 1 });
    expect((await s.annotations.listAnnotations(id)).map((annotation) => annotation.start)).toEqual([
      mine.start,
    ]);

    await db.insert(schema.annotations).values({
      documentId: id,
      termId: peace,
      start: 11,
      end: 16,
      toneId: await toneId("Negative"),
      source: "ai",
    });
    expect(await s.annotations.confirmSuggestions(id)).toEqual({ confirmed: 1 });
    expect(
      (await s.annotations.listAnnotations(id)).every((annotation) => annotation.source === "user"),
    ).toBe(true);
    await s.documents.deleteDocument(id);
  });

  it("accepting a suggested term adds it once and stops highlighting it everywhere", async () => {
    const { getDb, schema } = s.db;
    const one = await addDocument("One", "The blockade holds. The quarantine holds.");
    const two = await addDocument("Two", "A blockade is an act of war.");
    const db = await getDb();
    const insert = async (text: string) => {
      const [row] = await db
        .insert(schema.termSuggestions)
        .values({ text, normalized: text.toLowerCase(), rationale: "Central to the crisis." })
        .returning({ id: schema.termSuggestions.id });
      return row.id;
    };
    const blockade = await insert("blockade");
    const quarantine = await insert("quarantine");

    const before = await s.suggestions.listSuggestions();
    expect(before.pending.map((suggestion) => [suggestion.text, suggestion.total])).toEqual([
      ["blockade", 2],
      ["quarantine", 1],
    ]);
    expect(before.pending[0].perDocument).toEqual({ [one]: 1, [two]: 1 });

    await s.suggestions.decideSuggestion(blockade, "accepted");
    expect(
      (await s.terms.listTerms()).filter((term) => term.text === "blockade"),
    ).toHaveLength(1);
    expect((await s.suggestions.listSuggestions()).pending.map((suggestion) => suggestion.text)).toEqual([
      "quarantine",
    ]);
    await expect(s.suggestions.decideSuggestion(blockade, "rejected")).rejects.toThrow(
      /already on the term list/,
    );

    await s.suggestions.decideSuggestion(quarantine, "rejected");
    expect(await s.suggestions.listSuggestions()).toEqual({
      pending: [],
      rejected: [{ id: quarantine, text: "quarantine" }],
    });
    expect((await s.terms.listTerms()).some((term) => term.text === "quarantine")).toBe(false);

    await s.suggestions.decideSuggestion(quarantine, "pending");
    expect((await s.suggestions.listSuggestions()).pending.map((suggestion) => suggestion.text)).toEqual([
      "quarantine",
    ]);
  });

  it("counts tones by term, equivalence, category, subcategory, document, and overall", async () => {
    const foreign = await s.taxonomy.createCategory("Foreign");
    const treaties = await s.taxonomy.createCategory("Treaties", foreign.id);
    await expect(s.taxonomy.createCategory("Pacts", treaties.id)).rejects.toThrow(/subcategory/);
    await expect(s.taxonomy.createCategory("foreign")).rejects.toThrow(/already a category/);
    const domestic = await s.taxonomy.createCategory("Domestic");

    const peace = (await s.terms.listTerms()).find((term) => term.text === "peace")!;
    const war = (await s.terms.listTerms()).find((term) => term.text === "war")!;
    const tax = (await s.terms.listTerms()).find((term) => term.text === "tax")!;
    await s.taxonomy.setTermCategories(peace.id, [treaties.id]);
    await s.taxonomy.setTermCategories(war.id, [foreign.id, domestic.id]);
    await s.taxonomy.setTermCategories(tax.id, [domestic.id]);
    expect((await s.terms.listTerms()).find((term) => term.id === peace.id)?.categoryIds).toEqual([
      treaties.id,
    ]);

    const conflict = await s.taxonomy.createEquivalence("Conflict", [peace.id, war.id]);
    const revenue = await s.taxonomy.createEquivalence("Revenue", [tax.id]);
    await s.taxonomy.setTermEquivalence(tax.id, conflict.id);
    const afterMove = await s.terms.listTerms();
    expect(afterMove.find((term) => term.id === tax.id)?.equivalenceId).toBe(conflict.id);
    expect(afterMove.find((term) => term.id === peace.id)?.equivalenceId).toBe(conflict.id);
    await s.taxonomy.setTermEquivalence(tax.id, null);
    expect((await s.terms.listTerms()).find((term) => term.id === tax.id)?.equivalenceId).toBeNull();

    const id = await addDocument("Distribution", "Peace and war.");
    await tag(id, "war", 0, "Negative");
    const tagRow = await s.taxonomy.createDocumentTag("Crisis");
    await s.taxonomy.setDocumentTags(id, [tagRow.id]);
    const detail = await s.documents.getDocument(id);
    expect(detail.tags.map((item) => item.name)).toEqual(["Crisis"]);
    expect(
      (await s.documents.listDocuments()).find((document) => document.id === id)?.tags,
    ).toEqual([{ id: tagRow.id, name: "Crisis" }]);

    const category = await s.distribution.getToneDistribution("category", [id]);
    const names = category.tones.map((tone) => tone.name);
    const count = (label: string, tone: string) => {
      const row = category.rows.find((item) => item.label === label);
      return row?.counts[names.indexOf(tone)] ?? -1;
    };
    expect(count("Foreign", "Neutral")).toBe(1);
    expect(count("Foreign", "Negative")).toBe(1);
    expect(count("Domestic", "Negative")).toBe(1);
    expect(count("Domestic", "Neutral")).toBe(0);

    const subcategory = await s.distribution.getToneDistribution("subcategory", [id]);
    expect(subcategory.rows.map((row) => [row.label, row.total])).toEqual([["Foreign / Treaties", 1]]);

    const together = await s.distribution.getToneDistribution("equivalence", [id]);
    const conflictRow = together.rows.find((row) => row.label === "Conflict");
    expect(conflictRow?.total).toBe(2);

    const overall = await s.distribution.getToneDistribution("overall", [id]);
    expect(overall.rows[0]?.total).toBe(2);
    const csv = await s.distribution.toneDistributionCsv("overall", [id]);
    const csvLines = csv.split("\r\n");
    expect(csvLines[0].startsWith("how_to_read_this_file,")).toBe(true);
    expect(csvLines[1]).toBe(`scope,${overall.tones.map((tone) => tone.name).join(",")},total`);

    const byTerm = (await s.distribution.toneDistributionCsv("term", [id])).split("\r\n");
    expect(byTerm[1]).toBe(`term,categories,${names.join(",")},total`);
    const categoryCell = (label: string) =>
      byTerm.find((line) => line.startsWith(`${label},`))?.split(",")[1];
    expect(categoryCell("peace")).toBe("Foreign / Treaties");
    expect(categoryCell("war")).toBe("Domestic; Foreign");
    expect(categoryCell("tax")).toBe("Domestic");

    const counted = (await s.frequency.toneFrequencyCsv([id])).split("\r\n");
    const frequencyCategories = (term: string) =>
      counted.find((line) => line.startsWith(`Distribution,${term},`))?.split(",")[2];
    expect(frequencyCategories("peace")).toBe("Foreign / Treaties");
    expect(frequencyCategories("war")).toBe("Domestic; Foreign");

    const byDocument = await s.distribution.getToneDistribution("document", [id]);
    expect(byDocument.rows.map((row) => row.label)).toEqual(["Distribution"]);
    await s.documents.deleteDocument(id);
    await s.taxonomy.deleteEquivalence(conflict.id);
    await s.taxonomy.deleteEquivalence(revenue.id);
    expect((await s.terms.listTerms()).find((term) => term.id === peace.id)?.equivalenceId).toBeNull();
  });

  it("imports variants and places new and existing terms in an equivalence group", async () => {
    const result = await s.terms.importTerms([
      { text: "embargo", variants: ["embargoes"], equivalence: "Sanctions" },
      { text: "sanction", equivalence: "Sanctions" },
      { text: "freedom", equivalence: "Sanctions" },
    ]);
    expect(result.added.map((term) => term.text)).toEqual(["embargo", "sanction"]);
    expect(result.skipped.map((item) => item.text)).toEqual(["freedom"]);
    expect(result.skipped[0]?.reason).toMatch(/equivalence group "Sanctions"/);
    const terms = await s.terms.listTerms();
    const embargo = terms.find((term) => term.text === "embargo");
    expect(embargo?.variants).toEqual(["embargoes"]);
    expect(embargo?.equivalenceId).toBeTruthy();
    expect(terms.find((term) => term.text === "sanction")?.equivalenceId).toBe(embargo?.equivalenceId);
    expect(terms.find((term) => term.text === "freedom")?.equivalenceId).toBe(embargo?.equivalenceId);
    expect(result.groups).toEqual([{ name: "Sanctions", terms: ["embargo", "sanction", "freedom"] }]);
    expect(result.categories).toEqual([]);
  });

  it("imports categories and equivalent terms, including singular and plural forms", async () => {
    const { parseTermList } = await import("../lib/text/csv");
    const file = [
      "terms,categories,equivalents",
      "shoe(s) / slippers,footwear / apparel,boot(s)",
      "sandal,footwear,shoe",
    ].join("\n");
    const result = await s.terms.importTerms([
      ...parseTermList(file, "terms"),
      {
        text: "cannon",
        variants: ["cannons"],
        categories: ["ordnance"],
        equivalents: ["cannons", "artillery"],
      },
      { text: "treaty", categories: ["foreign"] },
      { text: "peace", categories: ["Diplomacy"] },
    ]);

    expect(result.added.map((term) => term.text)).toEqual([
      "shoe",
      "sandal",
      "cannon",
      "treaty",
      "boot",
      "boots",
      "artillery",
    ]);
    expect(result.skipped.map((item) => item.text)).toEqual(["peace", "cannons"]);
    expect(result.skipped.find((item) => item.text === "cannons")?.reason).toMatch(/already covered/);

    const terms = await s.terms.listTerms();
    const shoe = terms.find((term) => term.text === "shoe");
    const sandal = terms.find((term) => term.text === "sandal");
    const cannon = terms.find((term) => term.text === "cannon");
    const treaty = terms.find((term) => term.text === "treaty");
    const peace = terms.find((term) => term.text === "peace");
    expect(shoe?.variants).toEqual(["shoes", "slippers"]);
    expect(cannon?.variants).toEqual(["cannons"]);

    const categories = await s.taxonomy.listCategories();
    const names = (ids: number[] | undefined) =>
      (ids ?? [])
        .map((id) => categories.find((category) => category.id === id)?.name)
        .filter((name): name is string => Boolean(name))
        .sort();
    expect(names(shoe?.categoryIds)).toEqual(["apparel", "footwear"]);
    expect(names(sandal?.categoryIds)).toEqual(["footwear"]);
    expect(names(treaty?.categoryIds)).toEqual(["Foreign"]);
    expect(categories.filter((category) => category.name.toLowerCase() === "foreign")).toHaveLength(1);
    expect(names(peace?.categoryIds)).toEqual(["Diplomacy", "Treaties"]);

    const groupId = shoe?.equivalenceId;
    expect(groupId).toBeTruthy();
    expect(sandal?.equivalenceId).toBe(groupId);
    expect(terms.find((term) => term.text === "boot")?.equivalenceId).toBe(groupId);
    expect(terms.find((term) => term.text === "boots")?.equivalenceId).toBe(groupId);
    expect(cannon?.equivalenceId).not.toBe(groupId);
    expect(terms.find((term) => term.text === "artillery")?.equivalenceId).toBe(cannon?.equivalenceId);
    expect(result.groups.map((group) => group.name).sort()).toEqual(["cannon", "shoe"]);
    expect(result.categories.map((category) => category.name).sort()).toEqual([
      "Diplomacy",
      "Foreign",
      "apparel",
      "footwear",
      "ordnance",
    ]);
  });
});

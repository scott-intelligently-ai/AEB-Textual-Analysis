import { asc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import { badRequest, notFound } from "./http";

export interface ToneWithUsage extends schema.Tone {
  /** Number of term occurrences currently tagged with this tone. */
  usage: number;
}

export interface ToneInput {
  name?: string;
  color?: string;
  score?: number;
  isDefault?: boolean;
}

export function listTones(): schema.Tone[] {
  return getDb().select().from(schema.tones).orderBy(asc(schema.tones.sortOrder)).all();
}

export function listTonesWithUsage(): ToneWithUsage[] {
  const usage = new Map(
    getDb()
      .select({ toneId: schema.annotations.toneId, count: sql<number>`count(*)` })
      .from(schema.annotations)
      .groupBy(schema.annotations.toneId)
      .all()
      .map((row) => [row.toneId, row.count]),
  );
  return listTones().map((tone) => ({ ...tone, usage: usage.get(tone.id) ?? 0 }));
}

function checkName(name: string, excludeId?: number): string {
  const tidy = name.trim();
  if (!tidy) throw badRequest("A tone needs a name.");
  const clash = listTones().find(
    (tone) => tone.id !== excludeId && tone.name.toLowerCase() === tidy.toLowerCase(),
  );
  if (clash) throw badRequest(`There is already a tone called "${clash.name}".`);
  return tidy;
}

export function createTone(input: Required<Pick<ToneInput, "name" | "color">> & ToneInput): schema.Tone {
  const db = getDb();
  const tones = listTones();
  const tone = db
    .insert(schema.tones)
    .values({
      name: checkName(input.name),
      color: input.color,
      score: input.score ?? 0,
      sortOrder: tones.length === 0 ? 0 : Math.max(...tones.map((t) => t.sortOrder)) + 1,
      isDefault: tones.length === 0,
    })
    .returning()
    .get();
  return input.isDefault ? updateTone(tone.id, { isDefault: true }) : tone;
}

export function updateTone(id: number, input: ToneInput): schema.Tone {
  const db = getDb();
  const existing = db.select().from(schema.tones).where(eq(schema.tones.id, id)).get();
  if (!existing) throw notFound("Tone");
  if (input.isDefault === false && existing.isDefault) {
    throw badRequest("One tone must be the default. Make another tone the default instead.");
  }
  return db.transaction((tx) => {
    if (input.isDefault) tx.update(schema.tones).set({ isDefault: false }).run();
    return tx
      .update(schema.tones)
      .set({
        name: input.name === undefined ? existing.name : checkName(input.name, id),
        color: input.color ?? existing.color,
        score: input.score ?? existing.score,
        isDefault: input.isDefault ?? existing.isDefault,
      })
      .where(eq(schema.tones.id, id))
      .returning()
      .get();
  });
}

export function deleteTone(id: number): void {
  const db = getDb();
  const existing = db.select().from(schema.tones).where(eq(schema.tones.id, id)).get();
  if (!existing) throw notFound("Tone");
  if (existing.isDefault) {
    throw badRequest("The default tone cannot be deleted. Make another tone the default first.");
  }
  // Tags using this tone are removed with it, so those occurrences fall back to the default.
  db.delete(schema.tones).where(eq(schema.tones.id, id)).run();
}

export function reorderTones(ids: number[]): schema.Tone[] {
  const db = getDb();
  const known = new Set(listTones().map((tone) => tone.id));
  if (ids.length !== known.size || ids.some((id) => !known.has(id))) {
    throw badRequest("The new order must list every tone exactly once.");
  }
  db.transaction((tx) => {
    ids.forEach((id, sortOrder) => {
      tx.update(schema.tones).set({ sortOrder }).where(eq(schema.tones.id, id)).run();
    });
  });
  return listTones();
}

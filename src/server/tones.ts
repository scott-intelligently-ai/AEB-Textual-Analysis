import { asc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import { badRequest, notFound } from "./http";

export interface ToneWithUsage extends schema.Tone {
  /** Number of term occurrences currently tagged with this tone. */
  usage: number;
}

/** A definition is a sentence or two about what the tone means. */
export const TONE_DEFINITION_MAX = 500;

export interface ToneInput {
  name?: string;
  color?: string;
  score?: number;
  isDefault?: boolean;
  definition?: string | null;
}

export async function listTones(): Promise<schema.Tone[]> {
  const db = await getDb();
  return db.select().from(schema.tones).orderBy(asc(schema.tones.sortOrder));
}

export async function listTonesWithUsage(): Promise<ToneWithUsage[]> {
  const db = await getDb();
  const usage = new Map(
    (
      await db
        .select({ toneId: schema.annotations.toneId, count: sql<number>`count(*)::int` })
        .from(schema.annotations)
        .groupBy(schema.annotations.toneId)
    ).map((row) => [row.toneId, Number(row.count)]),
  );
  return (await listTones()).map((tone) => ({ ...tone, usage: usage.get(tone.id) ?? 0 }));
}

async function checkName(name: string, excludeId?: number): Promise<string> {
  const tidy = name.trim();
  if (!tidy) throw badRequest("A tone needs a name.");
  const clash = (await listTones()).find(
    (tone) => tone.id !== excludeId && tone.name.toLowerCase() === tidy.toLowerCase(),
  );
  if (clash) throw badRequest(`There is already a tone called "${clash.name}".`);
  return tidy;
}

function tidyDefinition(value: string): string | null {
  const tidy = value.trim();
  if (tidy.length > TONE_DEFINITION_MAX) {
    throw badRequest(`A tone definition can be at most ${TONE_DEFINITION_MAX} characters.`);
  }
  return tidy || null;
}

export async function createTone(
  input: Required<Pick<ToneInput, "name" | "color">> & ToneInput,
): Promise<schema.Tone> {
  const db = await getDb();
  const tones = await listTones();
  const [tone] = await db
    .insert(schema.tones)
    .values({
      name: await checkName(input.name),
      color: input.color,
      score: input.score ?? 0,
      definition: input.definition == null ? null : tidyDefinition(input.definition),
      sortOrder: tones.length === 0 ? 0 : Math.max(...tones.map((item) => item.sortOrder)) + 1,
      isDefault: tones.length === 0,
    })
    .returning();
  return input.isDefault ? updateTone(tone.id, { isDefault: true }) : tone;
}

export async function updateTone(id: number, input: ToneInput): Promise<schema.Tone> {
  const db = await getDb();
  const [existing] = await db.select().from(schema.tones).where(eq(schema.tones.id, id));
  if (!existing) throw notFound("Tone");
  if (input.isDefault === false && existing.isDefault) {
    throw badRequest("One tone must be the default. Make another tone the default instead.");
  }
  const name = input.name === undefined ? existing.name : await checkName(input.name, id);
  return db.transaction(async (tx) => {
    if (input.isDefault) await tx.update(schema.tones).set({ isDefault: false });
    const [tone] = await tx
      .update(schema.tones)
      .set({
        name,
        color: input.color ?? existing.color,
        score: input.score ?? existing.score,
        isDefault: input.isDefault ?? existing.isDefault,
        definition:
          input.definition === undefined ? existing.definition : tidyDefinition(input.definition ?? ""),
      })
      .where(eq(schema.tones.id, id))
      .returning();
    return tone;
  });
}

export async function deleteTone(id: number): Promise<void> {
  const db = await getDb();
  const [existing] = await db.select().from(schema.tones).where(eq(schema.tones.id, id));
  if (!existing) throw notFound("Tone");
  if (existing.isDefault) {
    throw badRequest("The default tone cannot be deleted. Make another tone the default first.");
  }
  // Tags using this tone are removed with it, so those occurrences fall back to the default.
  await db.delete(schema.tones).where(eq(schema.tones.id, id));
}

export async function reorderTones(ids: number[]): Promise<schema.Tone[]> {
  const db = await getDb();
  const known = new Set((await listTones()).map((tone) => tone.id));
  if (ids.length !== known.size || ids.some((id) => !known.has(id))) {
    throw badRequest("The new order must list every tone exactly once.");
  }
  await db.transaction(async (tx) => {
    for (let sortOrder = 0; sortOrder < ids.length; sortOrder += 1) {
      await tx.update(schema.tones).set({ sortOrder }).where(eq(schema.tones.id, ids[sortOrder]));
    }
  });
  return listTones();
}

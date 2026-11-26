import { eq } from "drizzle-orm";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { postgresOptions, transactionPoolerUrl } from "./connection";
import * as schema from "./schema";

export const DEFAULT_TONES = [
  {
    name: "Positive",
    color: "#16a34a",
    score: 1,
    isDefault: false,
    definition:
      'The author uses this appearance to present what the term refers to as good, worthy, or something to be sought or aspired to. Praise, credit, defense, hope, and a claim that it deserves something belong here. In "Africa deserves to decide its own future," Africa is used this way.',
  },
  {
    name: "Neutral",
    color: "#52525b",
    score: 0,
    isDefault: true,
    definition:
      'The author uses this appearance to mention what the term refers to without presenting it as good or bad. A fact, a definition, a name, or a description with no praise and no blame belongs here. In "Africa is one of Earth\'s continents," Africa is used this way.',
  },
  {
    name: "Negative",
    color: "#b91c1c",
    score: -1,
    isDefault: false,
    definition:
      'The author uses this appearance to present what the term refers to as bad, at fault, or something to be avoided or rejected. Blame, criticism, failure, threat, and a claim that it has fallen short belong here. In "Africa hasn\'t carried its weight in negotiations," Africa is used this way.',
  },
];

const defaultDefinition = (name: string): string | null =>
  DEFAULT_TONES.find((tone) => tone.name === name)?.definition ?? null;

/** Keeps a definition someone wrote. A blank default tone receives its starting text. */
function definitionToKeep(tone: schema.Tone): string | null {
  const written = tone.definition?.trim();
  return written || defaultDefinition(tone.name);
}

/** The five tones seeded before the default set was Positive, Neutral, and Negative. */
const LEGACY_DEFAULT_TONES = [
  "Very negative",
  "Negative",
  "Neutral",
  "Positive",
  "Very positive",
];

export type Db = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __speechDb?: Promise<Db> };

/** Used by the test setup to install an in-memory database before anything queries. */
export function setDatabase(db: Promise<Db>): void {
  globalForDb.__speechDb = db;
}

export function getDb(): Promise<Db> {
  if (!globalForDb.__speechDb) {
    if (process.env.VITEST) {
      throw new Error("The test database was not installed before it was used.");
    }
    globalForDb.__speechDb = openPostgres().catch((error: unknown) => {
      globalForDb.__speechDb = undefined;
      throw error;
    });
  }
  return globalForDb.__speechDb;
}

async function openPostgres(): Promise<Db> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Use the Supabase pooler connection string (port 6543).",
    );
  }
  const max = Number(process.env.DATABASE_POOL_MAX ?? 1);
  const client = postgres(
    transactionPoolerUrl(url),
    postgresOptions(url, Number.isInteger(max) && max > 0 ? max : 1),
  );
  const db = drizzle(client, { schema });
  await seed(db);
  return db;
}

function isLegacyDefaultSet(existing: schema.Tone[]): boolean {
  if (existing.length !== LEGACY_DEFAULT_TONES.length) return false;
  const names = new Set(existing.map((tone) => tone.name));
  return LEGACY_DEFAULT_TONES.every((name) => names.has(name));
}

/**
 * A library that still has the original five default tones, and no others, is
 * brought in line with the three defaults. Tags on the two removed tones move
 * to Negative or Positive. A set someone has renamed or extended is left as it is.
 */
async function replaceLegacyDefaultTones(db: Db, existing: schema.Tone[]): Promise<void> {
  if (!isLegacyDefaultSet(existing)) return;
  const byName = new Map(existing.map((tone) => [tone.name, tone]));
  const negative = byName.get("Negative")!;
  const neutral = byName.get("Neutral")!;
  const positive = byName.get("Positive")!;
  const veryNegative = byName.get("Very negative")!;
  const veryPositive = byName.get("Very positive")!;
  const keptDefault = [positive, neutral, negative].find((tone) => tone.isDefault) ?? neutral;

  await db.transaction(async (tx) => {
    const current = await tx.select().from(schema.tones);
    if (!isLegacyDefaultSet(current)) return;
    await tx
      .update(schema.annotations)
      .set({ toneId: negative.id })
      .where(eq(schema.annotations.toneId, veryNegative.id));
    await tx
      .update(schema.annotations)
      .set({ toneId: positive.id })
      .where(eq(schema.annotations.toneId, veryPositive.id));
    await tx.delete(schema.tones).where(eq(schema.tones.id, veryNegative.id));
    await tx.delete(schema.tones).where(eq(schema.tones.id, veryPositive.id));
    await tx.update(schema.tones).set({ isDefault: false });
    await tx
      .update(schema.tones)
      .set({
        sortOrder: 0,
        isDefault: keptDefault.id === positive.id,
        definition: definitionToKeep(positive),
      })
      .where(eq(schema.tones.id, positive.id));
    await tx
      .update(schema.tones)
      .set({
        sortOrder: 1,
        isDefault: keptDefault.id === neutral.id,
        definition: definitionToKeep(neutral),
      })
      .where(eq(schema.tones.id, neutral.id));
    await tx
      .update(schema.tones)
      .set({
        sortOrder: 2,
        isDefault: keptDefault.id === negative.id,
        definition: definitionToKeep(negative),
      })
      .where(eq(schema.tones.id, negative.id));
  });
}

export async function seed(db: Db): Promise<void> {
  const existing = await db.select().from(schema.tones);
  if (existing.length > 0) {
    await replaceLegacyDefaultTones(db, existing);
    return;
  }
  await db
    .insert(schema.tones)
    .values(DEFAULT_TONES.map((tone, sortOrder) => ({ ...tone, sortOrder })))
    .onConflictDoNothing();
}

export { schema };

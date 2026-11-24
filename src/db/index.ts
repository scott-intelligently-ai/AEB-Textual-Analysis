import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { postgresOptions } from "./connection";
import * as schema from "./schema";

export const DEFAULT_TONES = [
  { name: "Very negative", color: "#b91c1c", score: -2, isDefault: false },
  { name: "Negative", color: "#ea580c", score: -1, isDefault: false },
  { name: "Neutral", color: "#52525b", score: 0, isDefault: true },
  { name: "Positive", color: "#16a34a", score: 1, isDefault: false },
  { name: "Very positive", color: "#047857", score: 2, isDefault: false },
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
  const client = postgres(url, postgresOptions(url, Number.isInteger(max) && max > 0 ? max : 1));
  const db = drizzle(client, { schema });
  await seed(db);
  return db;
}

export async function seed(db: Db): Promise<void> {
  const existing = await db.select({ id: schema.tones.id }).from(schema.tones).limit(1);
  if (existing.length > 0) return;
  await db
    .insert(schema.tones)
    .values(DEFAULT_TONES.map((tone, sortOrder) => ({ ...tone, sortOrder })))
    .onConflictDoNothing();
}

export { schema };

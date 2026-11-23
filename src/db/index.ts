import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { inArray } from "drizzle-orm";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

export const DEFAULT_TONES = [
  { name: "Very negative", color: "#b91c1c", score: -2, isDefault: false },
  { name: "Negative", color: "#ea580c", score: -1, isDefault: false },
  { name: "Neutral", color: "#52525b", score: 0, isDefault: true },
  { name: "Positive", color: "#16a34a", score: 1, isDefault: false },
  { name: "Very positive", color: "#047857", score: 2, isDefault: false },
];

export type Db = BetterSQLite3Database<typeof schema>;

export function dataDir(): string {
  return process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.join(process.cwd(), "data");
}

export function uploadsDir(): string {
  return path.join(dataDir(), "uploads");
}

function open(): Db {
  fs.mkdirSync(uploadsDir(), { recursive: true });
  const sqlite = new Database(path.join(dataDir(), "app.db"));
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });

  if (db.select().from(schema.tones).limit(1).all().length === 0) {
    db.insert(schema.tones)
      .values(DEFAULT_TONES.map((tone, i) => ({ ...tone, sortOrder: i })))
      .run();
  }

  // OCR runs inside this process, so a page still marked as queued or running
  // when the database is opened was cut off by a restart.
  db.update(schema.pages)
    .set({
      ocrStatus: "error",
      ocrError: "Interrupted by a restart. Run OCR again.",
    })
    .where(inArray(schema.pages.ocrStatus, ["pending", "processing"]))
    .run();

  return db;
}

// Reuse one connection across dev-server hot reloads.
const globalForDb = globalThis as unknown as { __speechDb?: Db };

export function getDb(): Db {
  if (!globalForDb.__speechDb) globalForDb.__speechDb = open();
  return globalForDb.__speechDb;
}

export { schema };

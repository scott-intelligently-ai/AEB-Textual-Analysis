import path from "node:path";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { PGlite } from "@electric-sql/pglite";
import { seed, setDatabase, type Db } from "./index";
import * as schema from "./schema";

/** Opens a fresh in-memory Postgres and points the app at it. For tests only. */
export async function installTestDatabase(): Promise<void> {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });
  await seed(db as unknown as Db);
  setDatabase(Promise.resolve(db as unknown as Db));
}

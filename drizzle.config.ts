import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    // Migrations need a direct connection. The app itself uses the pooler URL.
    url: process.env.DIRECT_URL || process.env.DATABASE_URL || "postgres://localhost:5432/speech",
  },
});

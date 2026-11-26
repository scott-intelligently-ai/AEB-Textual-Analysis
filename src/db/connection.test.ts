import { describe, expect, it } from "vitest";
import { databaseUrlProblem, postgresOptions, transactionPoolerUrl } from "./connection";

const POOLER =
  "postgresql://postgres.qnicadgprxmeyjejbydg:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres";

describe("databaseUrlProblem", () => {
  it("accepts the transaction pooler URI", () => {
    expect(databaseUrlProblem(POOLER)).toBeUndefined();
  });

  it("rejects the direct Supabase host", () => {
    const problem = databaseUrlProblem(
      "postgresql://postgres:secret@db.qnicadgprxmeyjejbydg.supabase.co:5432/postgres",
    );
    expect(problem).toContain("pooler.supabase.com");
  });

  it("rejects the pooler host when the user is postgres", () => {
    const problem = databaseUrlProblem(
      "postgresql://postgres:secret@aws-0-us-east-1.pooler.supabase.com:6543/postgres",
    );
    expect(problem).toContain("postgres.<project-ref>");
  });

  it("uses the transaction pooler when the URL points at session mode", () => {
    const session =
      "postgresql://postgres.qnicadgprxmeyjejbydg:p%40ss@aws-0-us-east-1.pooler.supabase.com:5432/postgres";
    const next = new URL(transactionPoolerUrl(session));
    expect(next.port).toBe("6543");
    expect(next.username).toBe("postgres.qnicadgprxmeyjejbydg");
    expect(decodeURIComponent(next.password)).toBe("p@ss");
    expect(next.pathname).toBe("/postgres");
    expect(transactionPoolerUrl(POOLER)).toBe(POOLER);
    expect(transactionPoolerUrl("postgresql://postgres:secret@localhost:5432/postgres")).toBe(
      "postgresql://postgres:secret@localhost:5432/postgres",
    );
  });

  it("requires TLS for Supabase and leaves other hosts alone", () => {
    expect(postgresOptions(POOLER, 4).ssl).toBe("require");
    expect(postgresOptions("postgresql://postgres:secret@localhost:5432/postgres", 1).ssl).toBeUndefined();
  });
});

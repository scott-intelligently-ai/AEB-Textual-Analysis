import type { Options } from "postgres";

/**
 * Rejects Supabase URLs that connect from a laptop and fail on Railway.
 * The direct host is IPv6-only, and the pooler rejects the bare `postgres` user.
 */
export function databaseUrlProblem(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "DATABASE_URL is not a valid Postgres connection string. Encode @, #, and % in the password.";
  }
  const host = parsed.hostname;
  const user = decodeURIComponent(parsed.username);
  if (host.startsWith("db.") && host.endsWith(".supabase.co")) {
    return (
      "DATABASE_URL uses the direct database host db.<project>.supabase.co. " +
      "Copy the Transaction pooler URI from Supabase Connect. " +
      "Its host ends in pooler.supabase.com, its port is 6543, and its user is postgres.<project-ref>."
    );
  }
  if (host.includes("pooler.supabase.com") && user === "postgres") {
    return (
      "DATABASE_URL uses the pooler host with the user postgres. " +
      "The pooler user is postgres.<project-ref>. Copy the Transaction pooler URI from Supabase Connect."
    );
  }
  return undefined;
}

/**
 * The session pooler (port 5432) holds a database connection for the whole
 * client. A warm server keeps that connection, and Supabase stops new ones at
 * the pool size. The transaction pooler (port 6543) shares those connections.
 */
export function transactionPoolerUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!parsed.hostname.includes("pooler.supabase.com")) return url;
  if (parsed.port === "6543") return url;
  if (parsed.port !== "5432" && parsed.port !== "") return url;
  parsed.port = "6543";
  return parsed.href;
}

export function postgresOptions(url: string, max: number): Options {
  const problem = databaseUrlProblem(url);
  if (problem) throw new Error(problem);
  const host = new URL(url).hostname;
  const supabase = host.endsWith(".supabase.co") || host.includes("supabase.com");
  const transactionPooler = host.includes("pooler.supabase.com");
  return {
    prepare: false,
    max,
    idle_timeout: 20,
    connect_timeout: 15,
    // Supabase's transaction pooler answers pipelined queries out of order,
    // so a timestamp column can arrive as a missing or unrelated value.
    ...(transactionPooler ? { max_pipeline: 1 } : {}),
    ...(supabase ? { ssl: "require" as const } : {}),
  };
}

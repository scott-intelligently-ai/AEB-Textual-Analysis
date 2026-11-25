import { APIConnectionError, APIError } from "@typesafe-ai/sdk";
import { connection, type NextRequest } from "next/server";
import { z } from "zod";
import { JevConfigError } from "../lib/ai/jev";
import { AiConfigError } from "../lib/ai/models";
import { AuthError } from "../lib/auth/errors";
import { requireUser } from "../lib/supabase/server";

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found.`);
export const badRequest = (message: string) => new HttpError(400, message);

export function parseId(value: string, what: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw notFound(what);
  return id;
}

/** Reads a comma-separated id list from a query string; absent means "all". */
export function parseIdList(value: string | null): number[] | undefined {
  if (value === null) return undefined;
  const ids = value
    .split(",")
    .map(Number)
    .filter((id) => Number.isInteger(id) && id > 0);
  return ids;
}

export async function parseBody<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw badRequest("The request body is not valid JSON.");
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    const where = issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
    throw badRequest(`${where}${issue.message}`);
  }
  return result.data;
}

function describe(error: unknown): { status: number; message: string } {
  if (error instanceof HttpError || error instanceof AuthError) {
    return { status: error.status, message: error.message };
  }
  if (error instanceof AiConfigError || error instanceof JevConfigError) {
    return { status: 400, message: error.message };
  }
  if (error instanceof APIError || error instanceof APIConnectionError) {
    return { status: 502, message: `Jev returned an error: ${error.message}` };
  }
  if (error instanceof RangeError) return { status: 400, message: error.message };
  const message = error instanceof Error ? error.message : String(error);
  // Errors raised by the AI SDK carry the provider's explanation.
  if (error instanceof Error && error.name.startsWith("AI_")) {
    return { status: 502, message: `The AI provider returned an error: ${message}` };
  }
  console.error(error);
  return { status: 500, message };
}

type Handler<P> = (request: NextRequest, params: P) => unknown | Promise<unknown>;

/**
 * Wraps a route handler: results become JSON, thrown errors become a JSON
 * `{ error }` body with a matching status. `connection()` keeps handlers that
 * only read the (synchronous) database from being prerendered at build time.
 */
export function route<P = Record<string, never>>(handler: Handler<P>) {
  return async (request: NextRequest, context: { params: Promise<P> }) => {
    // Outside the try: during a build this rejects by design, and Next handles it.
    await connection();
    try {
      await requireUser();
      const result = await handler(request, await context.params);
      if (result instanceof Response) return result;
      return Response.json(result ?? { ok: true });
    } catch (error) {
      const { status, message } = describe(error);
      return Response.json({ error: message }, { status });
    }
  };
}

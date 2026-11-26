import { TypeSafeClient, type Questions } from "@typesafe-ai/sdk";

/**
 * The version every request names. `jev-latest` moves when TypeSafe ships a
 * release, which would change answers with no change here. Set
 * TYPESAFE_DEFAULT_MODEL to move to another version without a code change.
 */
export const JEV_PINNED_MODEL = "jev-1.14.0";

/** A passage with many occurrences can take longer than the SDK's 10 seconds. */
export const JEV_TIMEOUT_MS = 60_000;

export class JevConfigError extends Error {
  constructor(
    message = "TYPESAFE_API_KEY is not set, so Jev cannot suggest tones. Add the key to the environment and restart the app.",
  ) {
    super(message);
    this.name = "JevConfigError";
  }
}

export function jevModel(): string {
  const fromEnv = process.env.TYPESAFE_DEFAULT_MODEL?.trim();
  return fromEnv || JEV_PINNED_MODEL;
}

let client: TypeSafeClient | undefined;

function jevClient(): TypeSafeClient {
  const apiKey = process.env.TYPESAFE_API_KEY?.trim();
  if (!apiKey) throw new JevConfigError();
  if (!client) {
    client = new TypeSafeClient({ apiKey, defaultModel: jevModel(), logLevel: "warn" });
  }
  return client;
}

export interface JevRequest {
  state: Record<string, string>;
  questions: Questions;
}

/**
 * Ask Jev one request. A failed call throws. Callers must not read a failure
 * as an answer.
 */
export async function askJev({ state, questions }: JevRequest): Promise<Record<string, unknown>> {
  const response = await jevClient().systemOne(
    { state, questions, model: jevModel() },
    { timeout: JEV_TIMEOUT_MS },
  );
  if (!response?.answers || typeof response.answers !== "object") {
    throw new Error("Jev returned no answers.");
  }
  return response.answers;
}

import { mutate } from "swr";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function unwrap<T>(response: Response): Promise<T> {
  const text = await response.text();
  let data: unknown = undefined;
  try {
    data = text ? JSON.parse(text) : undefined;
  } catch {
    // Not JSON: fall through to the generic message below.
  }
  if (!response.ok) {
    const message =
      (data as { error?: string } | undefined)?.error ??
      `The request failed (${response.status} ${response.statusText}).`;
    throw new ApiError(response.status, message);
  }
  return data as T;
}

export const fetcher = <T>(url: string): Promise<T> => fetch(url).then((r) => unwrap<T>(r));

type Method = "POST" | "PUT" | "PATCH" | "DELETE";

/** Sends a change to the API, then refreshes everything on screen that reads from it. */
export async function send<T = unknown>(method: Method, url: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method };
  if (body instanceof FormData) {
    init.body = body;
  } else if (method !== "DELETE") {
    init.headers = { "Content-Type": "application/json" };
    init.body = JSON.stringify(body ?? {});
  }
  try {
    return await unwrap<T>(await fetch(url, init));
  } finally {
    void refreshAll();
  }
}

/** Revalidates every cached API read; data is small and local, so this stays cheap. */
export function refreshAll(): Promise<unknown> {
  return mutate(() => true);
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function downloadText(filename: string, text: string, type = "text/csv"): void {
  const url = URL.createObjectURL(new Blob(["\uFEFF", text], { type: `${type};charset=utf-8` }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

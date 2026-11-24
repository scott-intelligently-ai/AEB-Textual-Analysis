import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SCAN_BUCKET } from "../lib/storage";

let client: SupabaseClient | undefined;

function admin(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase Storage is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export async function ensureScanBucket(): Promise<void> {
  const { error } = await admin().storage.createBucket(SCAN_BUCKET, { public: false });
  if (error && !/already exists/i.test(error.message)) {
    throw new Error(`Could not prepare scan storage: ${error.message}`);
  }
}

export async function createUploadTicket(
  objectPath: string,
): Promise<{ path: string; token: string }> {
  await ensureScanBucket();
  const { data, error } = await admin()
    .storage.from(SCAN_BUCKET)
    .createSignedUploadUrl(objectPath, { upsert: true });
  if (error || !data) throw new Error(error?.message ?? "Could not prepare the upload.");
  return { path: objectPath, token: data.token };
}

export async function objectExists(objectPath: string): Promise<boolean> {
  const slash = objectPath.lastIndexOf("/");
  const folder = slash === -1 ? "" : objectPath.slice(0, slash);
  const name = objectPath.slice(slash + 1);
  const { data, error } = await admin().storage.from(SCAN_BUCKET).list(folder, {
    search: name,
    limit: 100,
  });
  if (error) throw new Error(error.message);
  return (data ?? []).some((entry) => entry.name === name);
}

export async function getObject(objectPath: string): Promise<Buffer> {
  const { data, error } = await admin().storage.from(SCAN_BUCKET).download(objectPath);
  if (error || !data) throw new Error(error?.message ?? "The stored file could not be read.");
  return Buffer.from(await data.arrayBuffer());
}

export async function putObject(
  objectPath: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await ensureScanBucket();
  const { error } = await admin().storage.from(SCAN_BUCKET).upload(objectPath, body, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(error.message);
}

export async function removeFolder(prefix: string): Promise<void> {
  const { data, error } = await admin().storage.from(SCAN_BUCKET).list(prefix, { limit: 1000 });
  if (error) {
    if (/not found|does not exist/i.test(error.message)) return;
    throw new Error(error.message);
  }
  const files: string[] = [];
  for (const entry of data ?? []) {
    const child = `${prefix}/${entry.name}`;
    // Folders come back without an object id; files are removed in one call.
    if (entry.id === null) await removeFolder(child);
    else files.push(child);
  }
  if (files.length === 0) return;
  const { error: removeError } = await admin().storage.from(SCAN_BUCKET).remove(files);
  if (removeError) throw new Error(removeError.message);
}

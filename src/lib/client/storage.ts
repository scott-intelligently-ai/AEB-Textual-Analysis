import { createClient } from "@supabase/supabase-js";
import { SCAN_BUCKET } from "@/lib/storage";

/** Uploads a scan with a token issued by the server. The file does not pass through the app. */
export async function uploadWithTicket(path: string, token: string, file: File): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Supabase is not configured. Set the public Supabase URL and anon key.");
  }
  const supabase = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supabase.storage.from(SCAN_BUCKET).uploadToSignedUrl(path, token, file, {
    contentType: file.type || "application/octet-stream",
  });
  if (error) throw new Error(error.message);
}

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { isAllowed } from "../auth/allowlist";
import { AuthError } from "../auth/errors";

export function supabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}

export async function createClient() {
  if (!supabaseConfigured()) {
    throw new AuthError(
      500,
      "Sign-in is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.",
    );
  }
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot set cookies. The proxy refreshes the session.
          }
        },
      },
    },
  );
}

export async function currentEmail(): Promise<string | null> {
  if (!supabaseConfigured()) return null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    const email = data.user?.email ?? null;
    return email && isAllowed(email) ? email : null;
  } catch {
    return null;
  }
}

/** Rejects requests that are not from a signed-in, allowed account. */
export async function requireUser(): Promise<{ email: string }> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const email = data.user?.email ?? null;
  if (!data.user || !email) throw new AuthError(401, "Sign in required.");
  if (!isAllowed(email)) {
    throw new AuthError(403, "This account is not allowed to use this application.");
  }
  return { email };
}

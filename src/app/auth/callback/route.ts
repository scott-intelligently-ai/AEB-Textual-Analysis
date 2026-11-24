import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** Finishes an email-confirmation or magic-link sign-in. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next");
  const destination =
    next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/login")
      ? next
      : "/";
  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }
  return NextResponse.redirect(new URL(destination, url.origin));
}

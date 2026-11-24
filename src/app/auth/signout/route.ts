import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch {
    // Still leave the page when sign-in is not configured.
  }
  return NextResponse.redirect(new URL("/login", request.url), 303);
}

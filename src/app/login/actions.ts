"use server";

import { isAllowed } from "@/lib/auth/allowlist";
import { AuthError } from "@/lib/auth/errors";
import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export interface AuthResult {
  error?: string;
  message?: string;
}

function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "/";
  if (!next.startsWith("/") || next.startsWith("//") || next.startsWith("/login")) return "/";
  return next;
}

interface Credentials {
  email: string;
  password: string;
  next: string;
}

function credentials(formData: FormData): Credentials | AuthResult {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!isAllowed(email)) {
    return {
      error: "This email is not on the list of accounts that can use this application.",
    };
  }
  if (password.length < 8) return { error: "Use a password of at least 8 characters." };
  return { email, password, next: safeNext(formData.get("next")) };
}

function rejected(value: Credentials | AuthResult): value is AuthResult {
  return !("email" in value);
}

export async function signIn(formData: FormData): Promise<AuthResult> {
  const parsed = credentials(formData);
  if (rejected(parsed)) return parsed;
  try {
    const supabase = await createClient();
    const { error } = await supabase.auth.signInWithPassword({
      email: parsed.email,
      password: parsed.password,
    });
    if (error) return { error: error.message };
  } catch (error) {
    if (error instanceof AuthError) return { error: error.message };
    throw error;
  }
  redirect(parsed.next);
}

export async function signUp(formData: FormData): Promise<AuthResult> {
  const parsed = credentials(formData);
  if (rejected(parsed)) return parsed;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.signUp({
      email: parsed.email,
      password: parsed.password,
    });
    if (error) return { error: error.message };
    if (!data.session) {
      return {
        message: "Check your email to confirm the account, then sign in.",
      };
    }
  } catch (error) {
    if (error instanceof AuthError) return { error: error.message };
    throw error;
  }
  redirect(parsed.next);
}

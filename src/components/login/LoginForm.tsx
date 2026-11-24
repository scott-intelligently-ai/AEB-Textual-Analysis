"use client";

import { useState } from "react";
import { signIn, signUp, type AuthResult } from "@/app/login/actions";
import { Button, TextInput } from "@/components/ui";

export function LoginForm({ next, notice }: { next: string; notice?: string }) {
  const [message, setMessage] = useState<string | null>(notice ?? null);
  const [pending, setPending] = useState<"in" | "up" | null>(null);

  async function submit(mode: "in" | "up", formData: FormData) {
    setPending(mode);
    setMessage(null);
    formData.set("next", next.startsWith("/") && !next.startsWith("//") ? next : "/");
    const result: AuthResult = mode === "in" ? await signIn(formData) : await signUp(formData);
    setPending(null);
    setMessage(result.error ?? result.message ?? null);
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4">
      <form
        className="w-full max-w-sm rounded-xl bg-white px-6 py-7 shadow-sm ring-1 ring-zinc-200"
        onSubmit={(event) => {
          event.preventDefault();
          void submit("in", new FormData(event.currentTarget));
        }}
      >
        <h1 className="text-lg font-semibold tracking-tight text-zinc-900">Speech Text Analysis</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Sign in to open your library. The same account works on every device.
        </p>
        <label className="mt-5 block text-sm font-medium text-zinc-800" htmlFor="email">
          Email
        </label>
        <TextInput
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          className="mt-1 w-full"
        />
        <label className="mt-3 block text-sm font-medium text-zinc-800" htmlFor="password">
          Password
        </label>
        <TextInput
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={8}
          className="mt-1 w-full"
        />
        {message ? <p className="mt-3 text-sm text-zinc-700">{message}</p> : null}
        <div className="mt-5 flex items-center gap-2">
          <Button type="submit" variant="primary" busy={pending === "in"} disabled={pending !== null}>
            Sign in
          </Button>
          <Button
            type="button"
            busy={pending === "up"}
            disabled={pending !== null}
            onClick={(event) => {
              const form = event.currentTarget.form;
              if (!form) return;
              void submit("up", new FormData(form));
            }}
          >
            Create account
          </Button>
        </div>
      </form>
    </main>
  );
}

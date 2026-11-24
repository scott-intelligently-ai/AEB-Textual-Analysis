import { currentEmail } from "@/lib/supabase/server";

export async function Account() {
  const email = await currentEmail();
  if (!email) return null;
  return (
    <form action="/auth/signout" method="post" className="mt-auto border-t border-zinc-200 px-2.5 pt-3">
      <p className="truncate text-xs text-zinc-500" title={email}>
        {email}
      </p>
      <button type="submit" className="mt-1 text-xs font-medium text-zinc-700 hover:underline">
        Sign out
      </button>
    </form>
  );
}

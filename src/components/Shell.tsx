"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { Nav, NavLinks } from "./Nav";

export function Shell({ account, children }: { account: ReactNode; children: ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/login") return children;
  return (
    <Frame account={account} nav={<Nav />}>
      {children}
    </Frame>
  );
}

/** Shown while the signed-in account is still loading. No path is known yet. */
export function ShellFallback({ children }: { children: ReactNode }) {
  return (
    <Frame account={null} nav={<NavLinks pathname={null} />}>
      {children}
    </Frame>
  );
}

function Frame({
  account,
  nav,
  children,
}: {
  account: ReactNode;
  nav: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen">
      <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-zinc-200 bg-white px-3 py-5">
        <div className="mb-6 px-2.5">
          <p className="text-sm font-semibold tracking-tight text-zinc-900">Speech Text Analysis</p>
          <p className="mt-0.5 text-xs text-zinc-500">Terms, frequency, and tone</p>
        </div>
        <nav aria-label="Main">{nav}</nav>
        {account}
      </aside>
      <main className="min-w-0 flex-1 px-8 py-8">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}

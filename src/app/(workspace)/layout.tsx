import { Suspense, type ReactNode } from "react";
import { Account } from "@/components/Account";
import { Shell, ShellFallback } from "@/components/Shell";

export default function WorkspaceLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<ShellFallback>{children}</ShellFallback>}>
      <Shell account={<Account />}>{children}</Shell>
    </Suspense>
  );
}

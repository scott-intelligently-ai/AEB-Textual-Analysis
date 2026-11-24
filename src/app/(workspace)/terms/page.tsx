import { Suspense } from "react";
import { TermsPage } from "@/components/terms/TermsPage";
import { LoadingBlock } from "@/components/ui";

export default function Page() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <TermsPage />
    </Suspense>
  );
}

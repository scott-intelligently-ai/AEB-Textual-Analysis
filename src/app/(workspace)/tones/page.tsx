import { Suspense } from "react";
import { ToneWorkspace } from "@/components/tones/ToneWorkspace";
import { LoadingBlock } from "@/components/ui";

export default function Page() {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <ToneWorkspace />
    </Suspense>
  );
}

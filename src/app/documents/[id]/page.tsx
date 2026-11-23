import { Suspense } from "react";
import { DocumentPage } from "@/components/document/DocumentPage";
import { LoadingBlock } from "@/components/ui";

export default function Page({ params }: PageProps<"/documents/[id]">) {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <DocumentPage params={params} />
    </Suspense>
  );
}

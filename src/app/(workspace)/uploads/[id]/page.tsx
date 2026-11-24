import { Suspense } from "react";
import { ReviewPage } from "@/components/review/ReviewPage";
import { LoadingBlock } from "@/components/ui";

export default function Page({ params }: PageProps<"/uploads/[id]">) {
  return (
    <Suspense fallback={<LoadingBlock />}>
      <ReviewPage params={params} />
    </Suspense>
  );
}

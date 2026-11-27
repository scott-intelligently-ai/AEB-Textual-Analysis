import { DownloadIcon } from "@/components/icons";
import { Card, PageHeader } from "@/components/ui";

export default function Page() {
  return (
    <>
      <PageHeader
        title="Test"
        description="Downloads that are still being tried out live here, so they can be run again later."
      />
      <Card className="p-5">
        <a
          href="/api/export/valence"
          download="valence.xlsx"
          className="inline-flex items-center gap-1.5 rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-500"
        >
          <DownloadIcon /> Test 1
        </a>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-600">
          An Excel workbook with one sheet for each document that contains at least one term.
          Each row is a term that appears in that document, with its variants, its category, and
          its valence. Valence adds 1 for each positive tone, 0 for each neutral tone, and −1 for
          each negative tone, across every appearance of the term or a variant. Within a sheet,
          terms are sorted by category, then by how often they appear.
        </p>
      </Card>
    </>
  );
}

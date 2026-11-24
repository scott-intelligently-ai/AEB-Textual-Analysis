"use client";

import useSWR from "swr";
import { ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui";
import { fetcher } from "@/lib/client/api";
import type { DocumentSummary, UploadSummary } from "@/lib/client/types";
import { DocumentsPanel } from "./DocumentsPanel";
import { UploadDropzone, UploadRow, isBusy } from "./UploadPanel";

export function LibraryPage() {
  const uploads = useSWR<UploadSummary[]>("/api/uploads", fetcher, {
    // Poll only while pages are still being converted.
    refreshInterval: (data) => (data?.some(isBusy) ? 1500 : 0),
  });
  const documents = useSWR<DocumentSummary[]>("/api/documents", fetcher);

  return (
    <>
      <PageHeader
        title="Documents"
        description="Upload a scan, a Word document, an RTF file, or plain text. Check the text, then create a document to analyse. Documents can be combined or split so that each one holds exactly one speech."
      />

      <section aria-labelledby="uploads-heading" className="mb-10">
        <h2 id="uploads-heading" className="mb-3 text-sm font-semibold text-zinc-900">
          Uploads
        </h2>
        <UploadDropzone />
        {uploads.error ? (
          <div className="mt-4">
            <ErrorBlock error={uploads.error} />
          </div>
        ) : uploads.data ? (
          <div className="mt-4 space-y-2">
            {uploads.data.map((upload) => (
              <UploadRow key={upload.id} upload={upload} />
            ))}
          </div>
        ) : (
          <LoadingBlock />
        )}
      </section>

      <section aria-labelledby="documents-heading">
        <h2 id="documents-heading" className="mb-3 text-sm font-semibold text-zinc-900">
          Documents
        </h2>
        {documents.error ? (
          <ErrorBlock error={documents.error} />
        ) : documents.data ? (
          <DocumentsPanel documents={documents.data} />
        ) : (
          <LoadingBlock />
        )}
      </section>
    </>
  );
}

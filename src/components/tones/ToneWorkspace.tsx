"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import useSWR from "swr";
import { ToneView } from "@/components/document/ToneView";
import { FrequencyPage } from "@/components/frequency/FrequencyPage";
import { ToneDistributionPanel } from "@/components/tones/ToneDistribution";
import { Button, EmptyState, ErrorBlock, LoadingBlock, PageHeader } from "@/components/ui";
import { fetcher } from "@/lib/client/api";
import type { Annotation, DocumentDetail, DocumentSummary, Term, Tone } from "@/lib/client/types";
import { TonesPage } from "./TonesPage";

export function ToneWorkspace() {
  const router = useRouter();
  const search = useSearchParams();
  const [defining, setDefining] = useState(false);
  const documents = useSWR<DocumentSummary[]>("/api/documents", fetcher);
  const terms = useSWR<Term[]>("/api/terms", fetcher);
  const tones = useSWR<Tone[]>("/api/tones", fetcher);

  if (defining) {
    return (
      <>
        <button
          type="button"
          onClick={() => setDefining(false)}
          className="mb-4 text-xs font-medium text-indigo-700 hover:underline"
        >
          ← Assign tones
        </button>
        <TonesPage />
      </>
    );
  }

  if (documents.error) return <ErrorBlock error={documents.error} />;
  if (!documents.data) return <LoadingBlock />;

  const list = documents.data;
  const requested = Number(search.get("document"));
  const current =
    list.find((document) => document.id === requested) ??
    [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id - a.id)[0];

  function choose(id: number) {
    const params = new URLSearchParams(search);
    params.set("document", String(id));
    router.replace(`/tones?${params.toString()}`);
  }

  return (
    <>
      <PageHeader
        title="Tones"
        description="Read a document with its terms highlighted and record the tone of each use. The distribution of those tones, and frequency for the documents you choose, are below."
        actions={
          <Button onClick={() => setDefining(true)}>Define tones</Button>
        }
      />

      {list.length === 0 ? (
        <EmptyState
          title="No document to mark yet"
          action={
            <Link
              href="/"
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
            >
              Go to documents
            </Link>
          }
        >
          Upload a scan and create a document from it first.
        </EmptyState>
      ) : current ? (
        <>
          <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold tracking-tight text-zinc-900">
                {current.title}
              </h2>
              <Link
                href={`/documents/${current.id}`}
                className="text-xs font-medium text-indigo-700 hover:underline"
              >
                Edit this document
              </Link>
            </div>
            {list.length > 1 ? (
              <label className="text-sm text-zinc-600">
                <span className="mr-2 font-medium">Document</span>
                <select
                  value={current.id}
                  onChange={(event) => choose(Number(event.target.value))}
                  className="rounded-md bg-white px-2 py-1.5 text-sm text-zinc-900 ring-1 ring-zinc-300 ring-inset"
                >
                  {list.map((document) => (
                    <option key={document.id} value={document.id}>
                      {document.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <DocumentTones id={current.id} terms={terms} tones={tones} />
        </>
      ) : null}

      <div className="mt-12 border-t border-zinc-200 pt-8">
        <ToneDistributionPanel />
      </div>

      <div className="mt-12 border-t border-zinc-200 pt-8">
        <FrequencyPage embedded />
      </div>
    </>
  );
}

function DocumentTones({
  id,
  terms,
  tones,
}: {
  id: number;
  terms: ReturnType<typeof useSWR<Term[]>>;
  tones: ReturnType<typeof useSWR<Tone[]>>;
}) {
  const document = useSWR<DocumentDetail>(`/api/documents/${id}`, fetcher);
  const annotations = useSWR<Annotation[]>(`/api/documents/${id}/annotations`, fetcher);
  const error = document.error ?? annotations.error ?? terms.error ?? tones.error;
  if (error) return <ErrorBlock error={error} />;
  if (!document.data || !annotations.data || !terms.data || !tones.data) return <LoadingBlock />;
  return (
    <ToneView
      document={document.data}
      terms={terms.data}
      tones={tones.data}
      annotations={annotations.data}
      mutateAnnotations={annotations.mutate}
    />
  );
}

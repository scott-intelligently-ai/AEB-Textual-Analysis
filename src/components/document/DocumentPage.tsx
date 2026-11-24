"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import useSWR from "swr";
import { useFeedback } from "@/components/feedback";
import { PencilIcon, TrashIcon } from "@/components/icons";
import { RenameDialog } from "@/components/library/DocumentsPanel";
import { ErrorBlock, IconButton, LoadingBlock } from "@/components/ui";
import { ApiError, fetcher, send } from "@/lib/client/api";
import type { Annotation, DocumentDetail, Term } from "@/lib/client/types";
import { EditView } from "./EditView";

export function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const { notify, notifyError, confirm } = useFeedback();
  const [renaming, setRenaming] = useState(false);

  const document = useSWR<DocumentDetail>(`/api/documents/${id}`, fetcher);
  const annotations = useSWR<Annotation[]>(`/api/documents/${id}/annotations`, fetcher);
  const terms = useSWR<Term[]>("/api/terms", fetcher);

  const error = document.error ?? annotations.error ?? terms.error;
  if (error) {
    return (
      <div className="space-y-3">
        <ErrorBlock error={error} />
        {error instanceof ApiError && error.status === 404 ? (
          <p className="text-sm text-zinc-600">
            It may have been deleted or combined into another document.{" "}
            <Link href="/" className="font-medium text-indigo-700 hover:underline">
              Back to documents
            </Link>
          </p>
        ) : null}
      </div>
    );
  }
  if (!document.data || !annotations.data || !terms.data) return <LoadingBlock />;
  const current = document.data;

  async function remove() {
    const ok = await confirm({
      title: "Delete this document?",
      body: (
        <>
          <strong>{current.title}</strong> and its tone tags will be deleted. The original scan is
          kept.
        </>
      ),
      confirmLabel: "Delete document",
      danger: true,
    });
    if (!ok) return;
    try {
      await send("DELETE", `/api/documents/${current.id}`);
      notify(`Deleted ${current.title}.`);
      router.push("/");
    } catch (cause) {
      notifyError(cause);
    }
  }

  return (
    <>
      <header className="mb-5">
        <Link href="/" className="text-xs font-medium text-indigo-700 hover:underline">
          ← Documents
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="min-w-0 truncate text-2xl font-semibold tracking-tight text-zinc-900">
            {current.title}
          </h1>
          <IconButton label="Rename document" onClick={() => setRenaming(true)}>
            <PencilIcon />
          </IconButton>
          <IconButton label="Delete document" onClick={remove}>
            <TrashIcon />
          </IconButton>
        </div>
        <p className="mt-2 text-sm text-zinc-600">
          Correct the text or split this document. Assign a tone to each term on the{" "}
          <Link
            href={`/tones?document=${current.id}`}
            className="font-medium text-indigo-700 hover:underline"
          >
            Tones
          </Link>{" "}
          page.
        </p>
      </header>

      <EditView document={current} terms={terms.data} annotations={annotations.data} />

      {renaming ? <RenameDialog document={current} onClose={() => setRenaming(false)} /> : null}
    </>
  );
}

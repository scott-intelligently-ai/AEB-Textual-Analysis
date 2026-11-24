"use client";

import Link from "next/link";
import { useState } from "react";
import { useFeedback } from "@/components/feedback";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  MergeIcon,
  PencilIcon,
  TrashIcon,
} from "@/components/icons";
import {
  Button,
  Card,
  EmptyState,
  IconButton,
  Modal,
  Notice,
  TextInput,
  formatDate,
} from "@/components/ui";
import { DocumentTagDialog, TagList } from "@/components/library/DocumentTags";
import { errorMessage, send } from "@/lib/client/api";
import type { DocumentSummary } from "@/lib/client/types";

export function DocumentsPanel({ documents }: { documents: DocumentSummary[] }) {
  const { notify, notifyError, confirm } = useFeedback();
  const [selected, setSelected] = useState<number[]>([]);
  const [combining, setCombining] = useState(false);
  const [renaming, setRenaming] = useState<DocumentSummary | null>(null);
  const [tagging, setTagging] = useState<DocumentSummary | null>(null);

  // Selection order is kept: it becomes the default order when combining.
  const live = selected.filter((id) => documents.some((document) => document.id === id));
  const toggle = (id: number) =>
    setSelected(live.includes(id) ? live.filter((other) => other !== id) : [...live, id]);

  async function remove(document: DocumentSummary) {
    const ok = await confirm({
      title: "Delete this document?",
      body: (
        <>
          <strong>{document.title}</strong> and its{" "}
          {document.annotationCount > 0 ? `${document.annotationCount} tone tags` : "text"} will be
          deleted. The uploaded file is kept.
        </>
      ),
      confirmLabel: "Delete document",
      danger: true,
    });
    if (!ok) return;
    try {
      await send("DELETE", `/api/documents/${document.id}`);
      notify(`Deleted ${document.title}.`);
    } catch (error) {
      notifyError(error);
    }
  }

  if (documents.length === 0) {
    return (
      <EmptyState title="No documents yet">
        Upload a file above. When its text is ready, create a document from it to start counting
        terms and tagging tone.
      </EmptyState>
    );
  }

  return (
    <>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm text-zinc-600">
          {live.length === 0
            ? "Select two or more documents to combine them, for example a speech that spans several scans."
            : `${live.length} selected`}
        </p>
        <Button disabled={live.length < 2} onClick={() => setCombining(true)}>
          <MergeIcon /> Combine selected
        </Button>
      </div>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium text-zinc-500">
            <tr>
              <th className="w-10 px-4 py-2">
                <span className="sr-only">Select</span>
              </th>
              <th className="px-2 py-2">Title</th>
              <th className="px-2 py-2">Tags</th>
              <th className="px-2 py-2 text-right">Words</th>
              <th className="px-2 py-2 text-right">Tone tags</th>
              <th className="px-2 py-2">Updated</th>
              <th className="w-20 px-4 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {documents.map((document) => (
              <tr key={document.id} className="hover:bg-zinc-50">
                <td className="px-4 py-2.5">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-zinc-300 accent-indigo-600"
                    checked={live.includes(document.id)}
                    onChange={() => toggle(document.id)}
                    aria-label={`Select ${document.title}`}
                  />
                </td>
                <td className="px-2 py-2.5">
                  <Link
                    href={`/documents/${document.id}`}
                    className="font-medium text-zinc-900 hover:text-indigo-700 hover:underline"
                  >
                    {document.title}
                  </Link>
                </td>
                <td className="px-2 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <TagList tags={document.tags} />
                    <Button size="sm" onClick={() => setTagging(document)}>
                      Edit tags
                    </Button>
                  </div>
                </td>
                <td className="px-2 py-2.5 text-right text-zinc-600 tabular-nums">
                  {document.words.toLocaleString()}
                </td>
                <td className="px-2 py-2.5 text-right text-zinc-600 tabular-nums">
                  {document.annotationCount.toLocaleString()}
                </td>
                <td className="px-2 py-2.5 text-zinc-600">{formatDate(document.updatedAt)}</td>
                <td className="px-4 py-2.5">
                  <div className="flex justify-end gap-1">
                    <IconButton
                      label={`Rename ${document.title}`}
                      onClick={() => setRenaming(document)}
                    >
                      <PencilIcon />
                    </IconButton>
                    <IconButton label={`Delete ${document.title}`} onClick={() => remove(document)}>
                      <TrashIcon />
                    </IconButton>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {combining ? (
        <CombineDialog
          documents={live.map((id) => documents.find((document) => document.id === id)!)}
          onClose={() => setCombining(false)}
          onDone={() => {
            setCombining(false);
            setSelected([]);
          }}
        />
      ) : null}
      {renaming ? <RenameDialog document={renaming} onClose={() => setRenaming(null)} /> : null}
      {tagging ? (
        <DocumentTagDialog
          documentId={tagging.id}
          selectedIds={tagging.tags.map((tag) => tag.id)}
          onClose={() => setTagging(null)}
        />
      ) : null}
    </>
  );
}

function CombineDialog({
  documents,
  onClose,
  onDone,
}: {
  documents: DocumentSummary[];
  onClose: () => void;
  onDone: () => void;
}) {
  const { notify } = useFeedback();
  const [order, setOrder] = useState(documents);
  const [title, setTitle] = useState(documents[0].title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function move(index: number, delta: -1 | 1) {
    const next = [...order];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    setOrder(next);
  }

  async function combine() {
    setBusy(true);
    setError(null);
    try {
      await send("POST", "/api/documents/combine", {
        ids: order.map((document) => document.id),
        title,
      });
      notify(`Combined ${order.length} documents into “${title.trim() || order[0].title}”.`);
      onDone();
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Combine documents"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={combine}>
            Combine {order.length} documents
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p>
          The text is joined in the order below. Tone tags move with their text, and the original
          documents are replaced by the combined one.
        </p>
        <ol className="divide-y divide-zinc-100 rounded-lg ring-1 ring-zinc-200">
          {order.map((document, index) => (
            <li key={document.id} className="flex items-center gap-3 px-3 py-2">
              <span className="w-5 text-right text-xs text-zinc-400 tabular-nums">{index + 1}</span>
              <span className="min-w-0 flex-1 truncate font-medium text-zinc-900">
                {document.title}
              </span>
              <IconButton
                label={`Move ${document.title} up`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                <ArrowUpIcon />
              </IconButton>
              <IconButton
                label={`Move ${document.title} down`}
                disabled={index === order.length - 1}
                onClick={() => move(index, 1)}
              >
                <ArrowDownIcon />
              </IconButton>
            </li>
          ))}
        </ol>
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-600">
            Title of the combined document
          </span>
          <TextInput value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        {error ? <Notice tone="red">{error}</Notice> : null}
      </div>
    </Modal>
  );
}

export function RenameDialog({
  document,
  onClose,
}: {
  document: { id: number; title: string };
  onClose: () => void;
}) {
  const [title, setTitle] = useState(document.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await send("PATCH", `/api/documents/${document.id}`, { title });
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Rename document"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={!title.trim()} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (title.trim()) void save();
        }}
      >
        <TextInput
          autoFocus
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          aria-label="Document title"
        />
        {error ? <Notice tone="red">{error}</Notice> : null}
      </form>
    </Modal>
  );
}

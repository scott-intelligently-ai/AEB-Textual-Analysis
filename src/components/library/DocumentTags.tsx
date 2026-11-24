"use client";

import { useState } from "react";
import useSWR from "swr";
import { useFeedback } from "@/components/feedback";
import { PencilIcon, PlusIcon, TrashIcon } from "@/components/icons";
import { Badge, Button, ErrorBlock, IconButton, LoadingBlock, Modal, Notice, TextInput } from "@/components/ui";
import { errorMessage, fetcher, send } from "@/lib/client/api";
import type { DocumentTag, DocumentTagSummary } from "@/lib/client/types";

export function TagList({ tags }: { tags: DocumentTagSummary[] }) {
  if (tags.length === 0) return <span className="text-zinc-400">None</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <Badge key={tag.id}>{tag.name}</Badge>
      ))}
    </span>
  );
}

export function DocumentTagDialog({
  documentId,
  selectedIds,
  onClose,
}: {
  documentId: number;
  selectedIds: number[];
  onClose: () => void;
}) {
  const tags = useSWR<DocumentTag[]>("/api/document-tags", fetcher);
  const [chosen, setChosen] = useState<number[]>(selectedIds);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<DocumentTag | null>(null);

  function toggle(id: number) {
    setChosen((current) => (current.includes(id) ? current.filter((other) => other !== id) : [...current, id]));
  }

  async function createTag() {
    setBusy(true);
    setError(null);
    try {
      const created = await send<DocumentTag>("POST", "/api/document-tags", { name });
      setChosen((current) => [...current, created.id]);
      setName("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await send("PUT", `/api/documents/${documentId}/tags`, { tagIds: chosen });
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  }

  return (
    <>
    <Modal
      title="Document tags"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} onClick={save}>
            Save tags
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-zinc-600">A document can have any number of tags.</p>
        {tags.error ? (
          <ErrorBlock error={tags.error} />
        ) : !tags.data ? (
          <LoadingBlock />
        ) : tags.data.length === 0 ? (
          <p className="text-sm text-zinc-500">No tags yet. Add one below.</p>
        ) : (
          <ul className="max-h-64 divide-y divide-zinc-100 overflow-y-auto rounded-lg ring-1 ring-zinc-200">
            {tags.data.map((tag) => (
              <li key={tag.id} className="flex items-center gap-2 px-2 py-1.5">
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-zinc-300 accent-indigo-600"
                    checked={chosen.includes(tag.id)}
                    onChange={() => toggle(tag.id)}
                  />
                  <span className="truncate text-zinc-900">{tag.name}</span>
                </label>
                <IconButton label={`Rename ${tag.name}`} onClick={() => setRenaming(tag)}>
                  <PencilIcon />
                </IconButton>
                <DeleteTagButton tag={tag} onRemoved={(id) => setChosen((current) => current.filter((item) => item !== id))} />
              </li>
            ))}
          </ul>
        )}
        <form
          className="flex items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) void createTag();
          }}
        >
          <label className="min-w-0 flex-1">
            <span className="mb-1 block text-xs font-medium text-zinc-600">New tag</span>
            <TextInput value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. 1962" />
          </label>
          <Button type="submit" size="sm" busy={busy} disabled={!name.trim()}>
            <PlusIcon /> Add
          </Button>
        </form>
        {error ? <Notice tone="red">{error}</Notice> : null}
      </div>
    </Modal>
    {renaming ? <RenameTagDialog tag={renaming} onClose={() => setRenaming(null)} /> : null}
    </>
  );
}

function DeleteTagButton({ tag, onRemoved }: { tag: DocumentTag; onRemoved: (id: number) => void }) {
  const { notify, notifyError, confirm } = useFeedback();

  async function remove() {
    const ok = await confirm({
      title: `Delete the tag “${tag.name}”?`,
      body: "It is removed from every document that uses it.",
      confirmLabel: "Delete tag",
      danger: true,
    });
    if (!ok) return;
    try {
      await send("DELETE", `/api/document-tags/${tag.id}`);
      onRemoved(tag.id);
      notify(`Deleted “${tag.name}”.`);
    } catch (cause) {
      notifyError(cause);
    }
  }

  return (
    <IconButton label={`Delete ${tag.name}`} onClick={remove}>
      <TrashIcon />
    </IconButton>
  );
}

function RenameTagDialog({ tag, onClose }: { tag: DocumentTag; onClose: () => void }) {
  const [name, setName] = useState(tag.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await send("PATCH", `/api/document-tags/${tag.id}`, { name });
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  }

  return (
    <Modal
      title="Rename tag"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={!name.trim()} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (name.trim()) void save();
        }}
      >
        <TextInput autoFocus value={name} onChange={(event) => setName(event.target.value)} aria-label="Tag name" />
        {error ? (
          <div className="mt-3">
            <Notice tone="red">{error}</Notice>
          </div>
        ) : null}
      </form>
    </Modal>
  );
}

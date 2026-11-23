"use client";

import { useRef, useState } from "react";
import { useFeedback } from "@/components/feedback";
import { ChevronLeftIcon, ChevronRightIcon, ScissorsIcon } from "@/components/icons";
import { Badge, Button, Card, Modal, Notice, TextInput, cx } from "@/components/ui";
import { errorMessage, send } from "@/lib/client/api";
import { revealSelection } from "@/lib/client/dom";
import type { Annotation, DocumentDetail, Term } from "@/lib/client/types";
import { rebaseSpans, splitPart } from "@/lib/text/documents";
import { countUncertain, nextUncertain } from "@/lib/text/transcription";

interface Props {
  document: DocumentDetail;
  terms: Term[];
  annotations: Annotation[];
}

export function EditView({ document, terms, annotations }: Props) {
  const { notify, notifyError, confirm } = useFeedback();
  const textarea = useRef<HTMLTextAreaElement>(null);

  const [base, setBase] = useState(document.text);
  const [draft, setDraft] = useState(document.text);
  if (base !== document.text) {
    setBase(document.text);
    setDraft(document.text);
  }

  const [cursor, setCursor] = useState(0);
  const [saving, setSaving] = useState(false);
  const [splitAt, setSplitAt] = useState<number | null>(null);
  const [showPages, setShowPages] = useState(document.sourcePages.length > 0);
  const [pageIndex, setPageIndex] = useState(0);

  const dirty = draft !== document.text;
  const uncertain = countUncertain(draft);
  const canSplit = !dirty && cursor > 0 && cursor < draft.length;
  const page = document.sourcePages[Math.min(pageIndex, document.sourcePages.length - 1)];

  async function save() {
    const cleared = rebaseSpans(document.text, draft, annotations, terms).dropped.length;
    if (cleared > 0) {
      const ok = await confirm({
        title: `This edit clears ${cleared} tone tag${cleared === 1 ? "" : "s"}`,
        body: "Tone tags on the words you changed cannot be kept, because the words they described are no longer the same. Tags everywhere else in the document stay as they are.",
        confirmLabel: "Save and clear them",
        danger: true,
      });
      if (!ok) return;
    }
    setSaving(true);
    try {
      const result = await send<{ cleared: number }>("PATCH", `/api/documents/${document.id}`, {
        text: draft,
      });
      notify(
        result.cleared > 0
          ? `Saved. ${result.cleared} tone tag${result.cleared === 1 ? " was" : "s were"} cleared.`
          : "Saved.",
      );
    } catch (error) {
      notifyError(error);
    } finally {
      setSaving(false);
    }
  }

  function findUncertain() {
    const field = textarea.current;
    if (!field) return;
    const hit = nextUncertain(draft, field.selectionEnd ?? 0);
    if (hit) revealSelection(field, hit.start, hit.end);
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={!dirty} busy={saving} onClick={save}>
          Save changes
        </Button>
        <Button variant="ghost" disabled={!dirty || saving} onClick={() => setDraft(document.text)}>
          Undo changes
        </Button>
        <span className="mx-1 h-5 w-px bg-zinc-200" />
        <Button
          disabled={!canSplit}
          onClick={() => setSplitAt(cursor)}
          title={
            dirty
              ? "Save your changes before splitting"
              : canSplit
                ? undefined
                : "Click in the text where the second document should begin"
          }
        >
          <ScissorsIcon /> Split at cursor
        </Button>
        <span className="text-xs text-zinc-500">
          {dirty
            ? "Save your changes before splitting."
            : canSplit
              ? "The text after the cursor becomes a new document."
              : "To split, click in the text where the second document should begin."}
        </span>
        {uncertain > 0 ? (
          <button type="button" className="ml-auto" onClick={findUncertain}>
            <Badge tone="amber">
              {uncertain} uncertain reading{uncertain === 1 ? "" : "s"} · find next
            </Badge>
          </button>
        ) : null}
        {document.sourcePages.length > 0 ? (
          <Button
            size="sm"
            variant="ghost"
            className={uncertain > 0 ? "" : "ml-auto"}
            onClick={() => setShowPages(!showPages)}
          >
            {showPages ? "Hide page images" : "Show page images"}
          </Button>
        ) : null}
      </div>

      <div className={cx("grid gap-4", showPages && page ? "lg:grid-cols-2" : "")}>
        <Card className="overflow-hidden">
          <textarea
            ref={textarea}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setCursor(event.target.selectionStart);
            }}
            onSelect={(event) => setCursor(event.currentTarget.selectionStart)}
            onClick={(event) => setCursor(event.currentTarget.selectionStart)}
            onKeyUp={(event) => setCursor(event.currentTarget.selectionStart)}
            spellCheck
            aria-label="Document text"
            className="document-text block h-[72vh] w-full resize-none border-0 bg-transparent px-6 py-5 text-zinc-900 focus:outline-none"
          />
        </Card>

        {showPages && page ? (
          <Card className="overflow-hidden">
            <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-2">
              <p className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900">
                {page.filename}, page {page.pageNumber}
              </p>
              <span className="text-xs text-zinc-500 tabular-nums">
                {pageIndex + 1} of {document.sourcePages.length}
              </span>
              <Button
                size="sm"
                disabled={pageIndex === 0}
                onClick={() => setPageIndex(pageIndex - 1)}
                aria-label="Previous page image"
              >
                <ChevronLeftIcon />
              </Button>
              <Button
                size="sm"
                disabled={pageIndex >= document.sourcePages.length - 1}
                onClick={() => setPageIndex(pageIndex + 1)}
                aria-label="Next page image"
              >
                <ChevronRightIcon />
              </Button>
            </div>
            <div className="h-[calc(72vh-2.6rem)] overflow-auto bg-zinc-100 p-3">
              {/* eslint-disable-next-line @next/next/no-img-element -- served from the local API, not optimisable */}
              <img
                src={`/api/pages/${page.id}/image`}
                alt={`Scan of ${page.filename}, page ${page.pageNumber}`}
                className="w-full rounded shadow-sm"
              />
            </div>
          </Card>
        ) : null}
      </div>

      {splitAt !== null ? (
        <SplitDialog
          document={document}
          annotations={annotations}
          offset={splitAt}
          onClose={() => setSplitAt(null)}
        />
      ) : null}
    </>
  );
}

function SplitDialog({
  document,
  annotations,
  offset,
  onClose,
}: {
  document: DocumentDetail;
  annotations: Annotation[];
  offset: number;
  onClose: () => void;
}) {
  const { notify } = useFeedback();
  const [firstTitle, setFirstTitle] = useState(`${document.title} (part 1)`);
  const [secondTitle, setSecondTitle] = useState(`${document.title} (part 2)`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  let preview: ReturnType<typeof splitPart<Annotation>> | null = null;
  let invalid: string | null = null;
  try {
    preview = splitPart(document.text, annotations, offset);
  } catch (cause) {
    invalid = errorMessage(cause);
  }

  async function split() {
    setBusy(true);
    setError(null);
    try {
      await send("POST", `/api/documents/${document.id}/split`, {
        offset,
        firstTitle,
        secondTitle,
      });
      notify(
        `Split into “${firstTitle.trim() || `${document.title} (part 1)`}” and “${secondTitle.trim() || `${document.title} (part 2)`}”. You are viewing the first part.`,
      );
      onClose();
    } catch (cause) {
      setError(errorMessage(cause));
      setBusy(false);
    }
  }

  const words = (text: string) => (text.match(/\S+/g)?.length ?? 0).toLocaleString();

  return (
    <Modal
      title="Split document"
      wide
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" busy={busy} disabled={preview === null} onClick={split}>
            Split into two documents
          </Button>
        </>
      }
    >
      {preview === null ? (
        <Notice tone="red">{invalid}</Notice>
      ) : (
        <div className="space-y-4">
          <p>
            Check that the cut falls in the right place. Tone tags stay with their text in each
            part.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-600">
                  First document ({words(preview.first.text)} words)
                </span>
                <TextInput
                  value={firstTitle}
                  onChange={(event) => setFirstTitle(event.target.value)}
                />
              </label>
              <p className="mt-2 text-xs font-medium text-zinc-500">Ends with</p>
              <p className="document-text mt-1 rounded-lg bg-zinc-50 px-3 py-2 text-sm! leading-6! ring-1 ring-zinc-200">
                {preview.first.text.length > 260 ? "… " : ""}
                {preview.first.text.slice(-260)}
              </p>
            </div>
            <div>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-zinc-600">
                  Second document ({words(preview.second.text)} words)
                </span>
                <TextInput
                  value={secondTitle}
                  onChange={(event) => setSecondTitle(event.target.value)}
                />
              </label>
              <p className="mt-2 text-xs font-medium text-zinc-500">Starts with</p>
              <p className="document-text mt-1 rounded-lg bg-zinc-50 px-3 py-2 text-sm! leading-6! ring-1 ring-zinc-200">
                {preview.second.text.slice(0, 260)}
                {preview.second.text.length > 260 ? " …" : ""}
              </p>
            </div>
          </div>
          {preview.dropped.length > 0 ? (
            <Notice>
              The cut falls inside {preview.dropped.length} tagged term
              {preview.dropped.length === 1 ? "" : "s"}; {preview.dropped.length === 1 ? "its" : "their"}{" "}
              tone tag{preview.dropped.length === 1 ? "" : "s"} will be cleared.
            </Notice>
          ) : null}
          {error ? <Notice tone="red">{error}</Notice> : null}
        </div>
      )}
    </Modal>
  );
}

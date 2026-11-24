"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useEffect, useEffectEvent, useRef, useState } from "react";
import useSWR from "swr";
import { useFeedback } from "@/components/feedback";
import { ChevronLeftIcon, ChevronRightIcon, RefreshIcon } from "@/components/icons";
import {
  Badge,
  Button,
  Card,
  ErrorBlock,
  LoadingBlock,
  Notice,
  PageHeader,
  Spinner,
  cx,
} from "@/components/ui";
import { fetcher, send } from "@/lib/client/api";
import type { PageSummary, UploadSummary } from "@/lib/client/types";
import { isBusy } from "@/components/library/UploadPanel";
import { PROVIDERS, PROVIDER_LABELS, type Provider } from "@/lib/ai/providers";
import { revealSelection } from "@/lib/client/dom";
import {
  ILLEGIBLE_MARK,
  UNSURE_MARK,
  countUncertain,
  nextUncertain,
} from "@/lib/text/transcription";

const isWorking = (page: PageSummary) =>
  page.ocrStatus === "pending" || page.ocrStatus === "processing";

export function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: upload, error } = useSWR<UploadSummary>(`/api/uploads/${id}`, fetcher, {
    refreshInterval: (data) => (data && isBusy(data) ? 1500 : 0),
  });

  if (error) return <ErrorBlock error={error} />;
  if (!upload) return <LoadingBlock />;
  if (upload.pages.length === 0) return <Preparing upload={upload} />;
  return <Review upload={upload} />;
}

function Preparing({ upload }: { upload: UploadSummary }) {
  return (
    <>
      <PageHeader
        title={upload.filename}
        description={
          <>
            <Link href="/" className="font-medium text-indigo-700 hover:underline">
              Back to documents
            </Link>
          </>
        }
      />
      {upload.status === "error" ? (
        <Notice tone="red">{upload.error ?? "This scan could not be prepared."}</Notice>
      ) : (
        <Notice tone="indigo">
          <Spinner className="size-3.5" /> Preparing the pages. This page updates on its own.
        </Notice>
      )}
    </>
  );
}

function Review({ upload }: { upload: UploadSummary }) {
  const router = useRouter();
  const { notify, notifyError, confirm } = useFeedback();
  const [index, setIndex] = useState(0);
  const page = upload.pages[Math.min(index, upload.pages.length - 1)];

  // The draft follows the saved text until the user types; a new transcription
  // from the server (after running conversion again) replaces it.
  const [base, setBase] = useState({ pageId: page.id, text: page.ocrText });
  const [draft, setDraft] = useState(page.ocrText);
  if (base.pageId !== page.id || base.text !== page.ocrText) {
    setBase({ pageId: page.id, text: page.ocrText });
    setDraft(page.ocrText);
  }

  const [saving, setSaving] = useState(false);
  const [creating, setCreating] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const [provider, setProvider] = useState<Provider | "">("");
  const textarea = useRef<HTMLTextAreaElement>(null);

  const dirty = draft !== page.ocrText;
  const working = isWorking(page);
  const uncertain = countUncertain(draft);
  const allDone = upload.pages.every((p) => p.ocrStatus === "done");
  const totalUncertain = upload.pages.reduce(
    (sum, p) => sum + countUncertain(p.id === page.id ? draft : p.ocrText),
    0,
  );

  async function save(): Promise<boolean> {
    if (!dirty) return true;
    setSaving(true);
    try {
      await send("PATCH", `/api/pages/${page.id}`, { text: draft });
      return true;
    } catch (cause) {
      notifyError(cause);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function goTo(next: number) {
    if (next < 0 || next >= upload.pages.length || next === index) return;
    if (await save()) setIndex(next);
  }

  async function rerun() {
    if (page.edited || dirty) {
      const ok = await confirm({
        title: "Replace your corrections?",
        body: "Running the conversion again replaces the text of this page, including the corrections you made by hand.",
        confirmLabel: "Run again",
        danger: true,
      });
      if (!ok) return;
    }
    try {
      await send("POST", `/api/pages/${page.id}/ocr`, provider ? { provider } : {});
    } catch (cause) {
      notifyError(cause);
    }
  }

  async function createDocument() {
    if (!(await save())) return;
    if (totalUncertain > 0) {
      const ok = await confirm({
        title: "Uncertain readings remain",
        body: `${totalUncertain} place${totalUncertain === 1 ? " is" : "s are"} still marked ${UNSURE_MARK} or ${ILLEGIBLE_MARK}. The markers will be carried into the document text. Create the document anyway?`,
        confirmLabel: "Create anyway",
      });
      if (!ok) return;
    }
    setCreating(true);
    try {
      const created = await send<{ id: number }>("POST", `/api/uploads/${upload.id}/document`, {});
      notify(`Created a document from ${upload.filename}.`);
      router.push(`/documents/${created.id}`);
    } catch (cause) {
      notifyError(cause);
      setCreating(false);
    }
  }

  function selectNextUncertain() {
    const field = textarea.current;
    if (!field) return;
    const hit = nextUncertain(draft, field.selectionEnd ?? 0);
    if (hit) revealSelection(field, hit.start, hit.end);
  }

  // Ctrl/Cmd+S saves the page being edited.
  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
      event.preventDefault();
      void save();
    }
  });
  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKey(event);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  return (
    <>
      <PageHeader
        title={upload.filename}
        description={
          <>
            Check each page of converted text against its image and correct any misread words. A
            misread word changes term counts, so this is worth doing before analysis.{" "}
            <Link href="/" className="font-medium text-indigo-700 hover:underline">
              Back to documents
            </Link>
          </>
        }
        actions={
          <Button
            variant="primary"
            disabled={!allDone}
            busy={creating}
            onClick={createDocument}
            title={allDone ? undefined : "Available once every page has been converted"}
          >
            Create document
          </Button>
        }
      />

      {upload.documents.length > 0 ? (
        <div className="mb-4">
          <Notice tone="indigo">
            A document has already been created from this scan (
            {upload.documents.map((document, i) => (
              <span key={document.id}>
                {i > 0 ? ", " : ""}
                <Link href={`/documents/${document.id}`} className="font-medium underline">
                  {document.title}
                </Link>
              </span>
            ))}
            ). Corrections made here do not change it; edit the document itself instead.
          </Notice>
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={index === 0} onClick={() => goTo(index - 1)}>
          <ChevronLeftIcon /> Previous
        </Button>
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Pages">
          {upload.pages.map((p, i) => (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={i === index}
              aria-label={`Page ${p.pageNumber}`}
              onClick={() => goTo(i)}
              className={cx(
                "relative min-w-7 rounded-md px-1.5 py-1 text-xs font-medium tabular-nums transition-colors",
                i === index
                  ? "bg-indigo-600 text-white"
                  : "bg-white text-zinc-700 ring-1 ring-zinc-200 ring-inset hover:bg-zinc-50",
              )}
            >
              {p.pageNumber}
              {p.ocrStatus === "error" ||
              countUncertain(p.id === page.id ? draft : p.ocrText) > 0 ? (
                <span
                  className={cx(
                    "absolute -top-0.5 -right-0.5 size-2 rounded-full ring-2 ring-white",
                    p.ocrStatus === "error" ? "bg-red-500" : "bg-amber-400",
                  )}
                />
              ) : null}
            </button>
          ))}
        </div>
        <Button
          size="sm"
          disabled={index === upload.pages.length - 1}
          onClick={() => goTo(index + 1)}
        >
          Next <ChevronRightIcon />
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-2">
            <p className="text-sm font-medium text-zinc-900">
              Page {page.pageNumber} of {upload.pages.length}
            </p>
            <Button size="sm" variant="ghost" onClick={() => setZoomed(!zoomed)}>
              {zoomed ? "Fit to width" : "Zoom in"}
            </Button>
          </div>
          <div className="max-h-[75vh] overflow-auto bg-zinc-100 p-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- served from the local API, not optimisable */}
            <img
              src={`/api/pages/${page.id}/image`}
              alt={`Scan of page ${page.pageNumber}`}
              className={cx("rounded shadow-sm", zoomed ? "w-[170%] max-w-none" : "w-full")}
            />
          </div>
        </Card>

        <Card className="flex flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 px-4 py-2">
            <p className="text-sm font-medium text-zinc-900">Converted text</p>
            {working ? (
              <Badge tone="indigo">
                <Spinner className="size-3" /> Converting
              </Badge>
            ) : page.ocrStatus === "error" ? (
              <Badge tone="red">Failed</Badge>
            ) : page.edited ? (
              <Badge tone="green">Corrected by you</Badge>
            ) : null}
            {uncertain > 0 ? (
              <button type="button" onClick={selectNextUncertain} title="Select the next marker">
                <Badge tone="amber">
                  {uncertain} uncertain reading{uncertain === 1 ? "" : "s"} · find next
                </Badge>
              </button>
            ) : null}
            <span className="ml-auto text-xs text-zinc-500">
              {dirty ? "Unsaved changes" : page.ocrModel ? `Converted by ${page.ocrModel}` : ""}
            </span>
          </div>
          {page.ocrStatus === "error" ? (
            <div className="px-4 pt-3">
              <Notice tone="red">
                This page could not be converted: {page.ocrError} Run the conversion again, or type
                the text by hand.
              </Notice>
            </div>
          ) : null}
          <textarea
            ref={textarea}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={working}
            spellCheck
            aria-label={`Converted text of page ${page.pageNumber}`}
            className="document-text min-h-[55vh] flex-1 resize-y border-0 bg-transparent px-5 py-4 text-zinc-900 focus:outline-none disabled:text-zinc-400"
            placeholder={working ? "Converting this page to text…" : "No text was found on this page."}
          />
          <div className="flex flex-wrap items-center gap-2 border-t border-zinc-200 bg-zinc-50 px-4 py-2.5">
            <Button variant="primary" disabled={!dirty} busy={saving} onClick={() => void save()}>
              Save page
            </Button>
            <div className="ml-auto flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-xs text-zinc-600">
                Convert with
                <select
                  value={provider}
                  onChange={(event) => setProvider(event.target.value as Provider | "")}
                  className="rounded-md border-0 bg-white py-1 pr-7 pl-2 text-xs text-zinc-900 ring-1 ring-zinc-300 ring-inset focus:ring-2 focus:ring-indigo-600"
                >
                  <option value="">Default provider</option>
                  {PROVIDERS.map((value) => (
                    <option key={value} value={value}>
                      {PROVIDER_LABELS[value]}
                    </option>
                  ))}
                </select>
              </label>
              <Button size="sm" disabled={working} onClick={rerun}>
                <RefreshIcon /> Run again
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { useFeedback } from "@/components/feedback";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SparklesIcon,
  XIcon,
} from "@/components/icons";
import { MarkedText } from "@/components/MarkedText";
import {
  Button,
  Card,
  EmptyState,
  ErrorBlock,
  IconButton,
  LoadingBlock,
  Notice,
  PageHeader,
  TextArea,
  cx,
} from "@/components/ui";
import { fetcher, send } from "@/lib/client/api";
import type {
  DocumentDetail,
  DocumentSummary,
  GenerateResult,
  PendingSuggestion,
  SettingsResponse,
  SuggestionsResponse,
  Term,
} from "@/lib/client/types";
import { findOccurrences } from "@/lib/text/match";

interface Focus {
  suggestionId: number;
  /** Which occurrence in the open document to show. */
  index: number;
  /** Bring that occurrence into view; off when the user clicked it in the text. */
  scroll: boolean;
}

type ViewerMark =
  | { kind: "suggestion"; start: number; end: number; suggestionId: number; ordinal: number }
  | { kind: "term"; start: number; end: number };

export function DiscoverPage() {
  const settings = useSWR<SettingsResponse>("/api/settings", fetcher);
  const suggestions = useSWR<SuggestionsResponse>("/api/suggestions", fetcher);
  const documents = useSWR<DocumentSummary[]>("/api/documents", fetcher);
  const terms = useSWR<Term[]>("/api/terms", fetcher);

  const error = settings.error ?? suggestions.error ?? documents.error ?? terms.error;
  if (error) return <ErrorBlock error={error} />;
  if (!settings.data || !suggestions.data || !documents.data || !terms.data) {
    return <LoadingBlock />;
  }
  return (
    <Discover
      settings={settings.data}
      suggestions={suggestions.data}
      documents={documents.data}
      terms={terms.data}
    />
  );
}

function Discover({
  settings,
  suggestions,
  documents,
  terms,
}: {
  settings: SettingsResponse;
  suggestions: SuggestionsResponse;
  documents: DocumentSummary[];
  terms: Term[];
}) {
  const { notify, notifyError } = useFeedback();

  const [purposeBase, setPurposeBase] = useState(settings.analysisPurpose);
  const [purpose, setPurpose] = useState(settings.analysisPurpose);
  if (purposeBase !== settings.analysisPurpose) {
    setPurposeBase(settings.analysisPurpose);
    setPurpose(settings.analysisPurpose);
  }
  const [savingPurpose, setSavingPurpose] = useState(false);
  const [running, setRunning] = useState(false);
  const [lastRun, setLastRun] = useState<GenerateResult | null>(null);
  const [deciding, setDeciding] = useState<number | null>(null);
  const [focus, setFocus] = useState<Focus | null>(null);
  const [chosenDocument, setChosenDocument] = useState<number | null>(null);

  const purposeDirty = purpose !== settings.analysisPurpose;
  const provider = settings.providers.find((p) => p.provider === settings.analysisProvider);
  const pending = suggestions.pending;
  const focused = focus ? pending.find((s) => s.id === focus.suggestionId) : undefined;

  const documentId =
    chosenDocument !== null && documents.some((d) => d.id === chosenDocument)
      ? chosenDocument
      : (documents[0]?.id ?? null);

  const perDocumentTotals = useMemo(() => {
    const totals = new Map<number, number>();
    for (const suggestion of pending) {
      for (const [id, count] of Object.entries(suggestion.perDocument)) {
        totals.set(Number(id), (totals.get(Number(id)) ?? 0) + count);
      }
    }
    return totals;
  }, [pending]);

  async function savePurpose(): Promise<boolean> {
    if (!purposeDirty) return true;
    setSavingPurpose(true);
    try {
      await send("PUT", "/api/settings", { analysisPurpose: purpose });
      return true;
    } catch (error) {
      notifyError(error);
      return false;
    } finally {
      setSavingPurpose(false);
    }
  }

  async function run() {
    if (!(await savePurpose())) return;
    setRunning(true);
    setLastRun(null);
    try {
      setLastRun(await send<GenerateResult>("POST", "/api/suggestions", {}));
    } catch (error) {
      notifyError(error);
    } finally {
      setRunning(false);
    }
  }

  async function decide(suggestion: PendingSuggestion, status: "accepted" | "rejected") {
    setDeciding(suggestion.id);
    try {
      await send("PATCH", `/api/suggestions/${suggestion.id}`, { status });
      if (focus?.suggestionId === suggestion.id) setFocus(null);
      notify(
        status === "accepted"
          ? `Added “${suggestion.text}” to your terms. It is no longer highlighted here.`
          : `Excluded “${suggestion.text}”. It will not be suggested again.`,
      );
    } catch (error) {
      notifyError(error);
    } finally {
      setDeciding(null);
    }
  }

  async function restore(id: number) {
    try {
      await send("PATCH", `/api/suggestions/${id}`, { status: "pending" });
    } catch (error) {
      notifyError(error);
    }
  }

  /** Shows a suggestion in a document that contains it, switching document if needed. */
  function show(suggestion: PendingSuggestion) {
    const here = documentId !== null && (suggestion.perDocument[documentId] ?? 0) > 0;
    if (!here) {
      const other = documents.find((d) => (suggestion.perDocument[d.id] ?? 0) > 0);
      if (other) setChosenDocument(other.id);
    }
    setFocus({ suggestionId: suggestion.id, index: 0, scroll: true });
  }

  function stepFocus(delta: 1 | -1) {
    if (!focus || !focused || documentId === null) return;
    const count = focused.perDocument[documentId] ?? 0;
    if (count === 0) return;
    setFocus({ ...focus, index: (focus.index + delta + count) % count, scroll: true });
  }

  return (
    <>
      <PageHeader
        title="Discover terms"
        description="Describe what your analysis is for, and the AI reads your documents for terms you may have overlooked. Suggested terms are highlighted in yellow. Include the ones you want and exclude the rest; this is separate from tone, and nothing is counted until you include it."
      />

      <div className="grid gap-6 lg:grid-cols-[24rem_minmax(0,1fr)]">
        <div className="space-y-4 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto lg:pr-1 lg:pb-1">
          <Card className="p-4">
            <label className="block">
              <span className="text-sm font-semibold text-zinc-900">
                What is this analysis for?
              </span>
              <span className="mt-1 mb-2 block text-xs leading-5 text-zinc-500">
                Say what you want to learn from these speeches. The AI uses this, together with the
                terms you already have, to judge which terms matter. It is also used when the AI
                suggests tones.
              </span>
              <TextArea
                rows={5}
                value={purpose}
                onChange={(event) => setPurpose(event.target.value)}
                placeholder="e.g. I am studying how the administration's framing of the Soviet threat shifted between 1961 and 1963."
              />
            </label>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button
                variant="primary"
                busy={running}
                disabled={!purpose.trim() || documents.length === 0 || !provider?.hasKey}
                onClick={run}
              >
                {running ? (
                  "Reading your documents…"
                ) : (
                  <>
                    <SparklesIcon /> Look for overlooked terms
                  </>
                )}
              </Button>
              {purposeDirty ? (
                <Button busy={savingPurpose} onClick={() => void savePurpose()}>
                  Save description
                </Button>
              ) : null}
            </div>
            <p className="mt-2 text-xs leading-5 text-zinc-500">
              {!purpose.trim()
                ? "Describe your analysis to begin."
                : documents.length === 0
                  ? "Create a document first; the AI needs text to read."
                  : `Reads ${documents.length} document${documents.length === 1 ? "" : "s"} and takes your ${terms.length} existing term${terms.length === 1 ? "" : "s"} into account.`}
            </p>
            {provider && !provider.hasKey ? (
              <div className="mt-2">
                <Notice tone="red">
                  No API key is set for {provider.label}. Add {provider.keyVariable} or choose
                  another provider in{" "}
                  <Link href="/settings" className="font-medium underline">
                    Settings
                  </Link>
                  .
                </Notice>
              </div>
            ) : null}
            {lastRun ? (
              <div className="mt-3">
                <Notice tone={lastRun.added > 0 ? "indigo" : "amber"}>
                  {lastRun.added > 0
                    ? `Found ${lastRun.added} new term${lastRun.added === 1 ? "" : "s"} to consider.`
                    : "The AI found no new terms to suggest this time."}
                  {lastRun.notFound.length > 0
                    ? ` ${lastRun.notFound.length} proposal${lastRun.notFound.length === 1 ? " was" : "s were"} dropped because the wording does not appear in your documents.`
                    : ""}
                </Notice>
              </div>
            ) : null}
          </Card>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-zinc-900">
              Suggested terms{pending.length > 0 ? ` (${pending.length})` : ""}
            </h2>
            {pending.length === 0 ? (
              <EmptyState title="No suggestions waiting">
                Run the search above. Suggestions stay here until you include or exclude them.
              </EmptyState>
            ) : (
              <ul className="space-y-2">
                {pending.map((suggestion) => {
                  const selected = focus?.suggestionId === suggestion.id;
                  const inDocuments = Object.keys(suggestion.perDocument).length;
                  const here = documentId === null ? 0 : (suggestion.perDocument[documentId] ?? 0);
                  return (
                    <li key={suggestion.id} id={`suggestion-${suggestion.id}`}>
                      <Card
                        className={cx(
                          "p-3 transition-shadow",
                          selected && "ring-2 ring-amber-500",
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <button
                            type="button"
                            onClick={() => show(suggestion)}
                            className="min-w-0 text-left"
                            title="Show in the document"
                          >
                            <span className="suggestion-mark font-serif text-base font-semibold text-zinc-900">
                              {suggestion.text}
                            </span>
                          </button>
                          <span className="shrink-0 text-xs text-zinc-500">
                            {suggestion.total} use{suggestion.total === 1 ? "" : "s"} in{" "}
                            {inDocuments} document{inDocuments === 1 ? "" : "s"}
                          </span>
                        </div>
                        <p className="mt-1.5 text-sm leading-5 text-zinc-700">
                          {suggestion.rationale}
                        </p>
                        <div className="mt-2.5 flex flex-wrap items-center gap-2">
                          <Button
                            size="sm"
                            variant="primary"
                            disabled={deciding !== null}
                            busy={deciding === suggestion.id}
                            onClick={() => decide(suggestion, "accepted")}
                          >
                            <CheckIcon /> Include
                          </Button>
                          <Button
                            size="sm"
                            disabled={deciding !== null}
                            onClick={() => decide(suggestion, "rejected")}
                          >
                            <XIcon /> Exclude
                          </Button>
                          {selected && here > 1 ? (
                            <span className="ml-auto flex items-center gap-1 text-xs text-zinc-500">
                              <IconButton label="Previous occurrence" onClick={() => stepFocus(-1)}>
                                <ChevronLeftIcon />
                              </IconButton>
                              {(focus?.index ?? 0) + 1} of {here}
                              <IconButton label="Next occurrence" onClick={() => stepFocus(1)}>
                                <ChevronRightIcon />
                              </IconButton>
                            </span>
                          ) : !selected ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="ml-auto"
                              onClick={() => show(suggestion)}
                            >
                              Show in document
                            </Button>
                          ) : null}
                        </div>
                      </Card>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {suggestions.rejected.length > 0 ? (
            <details className="rounded-xl bg-white px-4 py-3 shadow-sm ring-1 ring-zinc-200">
              <summary className="cursor-pointer text-sm font-medium text-zinc-700">
                Excluded terms ({suggestions.rejected.length})
              </summary>
              <p className="mt-2 text-xs leading-5 text-zinc-500">
                These will not be suggested again. Restore one to reconsider it.
              </p>
              <ul className="mt-2 divide-y divide-zinc-100">
                {suggestions.rejected.map((item) => (
                  <li key={item.id} className="flex items-center justify-between gap-2 py-1.5">
                    <span className="text-sm text-zinc-800">{item.text}</span>
                    <Button size="sm" variant="ghost" onClick={() => restore(item.id)}>
                      Restore
                    </Button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>

        <div className="min-w-0">
          {documentId === null ? (
            <EmptyState
              title="No documents yet"
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
          ) : (
            <Viewer
              key={documentId}
              documentId={documentId}
              documents={documents}
              totals={perDocumentTotals}
              pending={pending}
              terms={terms}
              focus={focus}
              onChooseDocument={(id) => {
                setChosenDocument(id);
                setFocus(null);
              }}
              onFocus={setFocus}
            />
          )}
        </div>
      </div>
    </>
  );
}

function Viewer({
  documentId,
  documents,
  totals,
  pending,
  terms,
  focus,
  onChooseDocument,
  onFocus,
}: {
  documentId: number;
  documents: DocumentSummary[];
  totals: Map<number, number>;
  pending: PendingSuggestion[];
  terms: Term[];
  focus: Focus | null;
  onChooseDocument: (id: number) => void;
  onFocus: (focus: Focus | null) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const document = useSWR<DocumentDetail>(`/api/documents/${documentId}`, fetcher);
  const text = document.data?.text;

  const marks = useMemo<ViewerMark[]>(() => {
    if (text === undefined) return [];
    const ordinals = new Map<number, number>();
    const suggested: ViewerMark[] = findOccurrences(
      text,
      pending.map(({ id, text: phrase }) => ({ id, text: phrase })),
    ).map((occurrence) => {
      const ordinal = ordinals.get(occurrence.termId) ?? 0;
      ordinals.set(occurrence.termId, ordinal + 1);
      return {
        kind: "suggestion",
        start: occurrence.start,
        end: occurrence.end,
        suggestionId: occurrence.termId,
        ordinal,
      };
    });
    // Existing terms are shown for context, but never on top of a suggestion.
    const existing: ViewerMark[] = findOccurrences(text, terms)
      .filter((o) => !suggested.some((s) => o.start < s.end && s.start < o.end))
      .map((o) => ({ kind: "term", start: o.start, end: o.end }));
    return [...suggested, ...existing];
  }, [text, pending, terms]);

  const focusId = focus?.suggestionId;
  const focusIndex = focus?.index;
  const focusScroll = focus?.scroll ?? false;
  const ready = text !== undefined;
  useEffect(() => {
    if (!ready || !focusScroll || focusId === undefined || focusIndex === undefined) return;
    container.current
      ?.querySelector(`[data-suggestion="${focusId}"][data-ordinal="${focusIndex}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [ready, focusScroll, focusId, focusIndex]);

  const here = totals.get(documentId) ?? 0;

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-zinc-200 px-5 py-3">
        <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
          <span className="shrink-0 font-medium text-zinc-700">Document</span>
          <select
            value={documentId}
            onChange={(event) => onChooseDocument(Number(event.target.value))}
            className="min-w-0 flex-1 rounded-md border-0 bg-white py-1.5 pr-8 pl-2.5 text-sm text-zinc-900 ring-1 ring-zinc-300 ring-inset focus:ring-2 focus:ring-indigo-600"
          >
            {documents.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title} ({totals.get(item.id) ?? 0} highlighted)
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-3 text-xs text-zinc-600">
          <span>
            <span className="suggestion-mark" style={{ cursor: "default" }}>
              suggested term
            </span>
          </span>
          <span>
            <span className="existing-term-mark">term already on your list</span>
          </span>
        </div>
      </div>
      {document.error ? (
        <div className="p-5">
          <ErrorBlock error={document.error} />
        </div>
      ) : text === undefined ? (
        <div className="px-5">
          <LoadingBlock />
        </div>
      ) : (
        <div ref={container} className="px-8 py-7">
          {pending.length > 0 && here === 0 ? (
            <div className="mb-4 font-sans">
              <Notice>None of the suggested terms appear in this document.</Notice>
            </div>
          ) : null}
          <MarkedText
            text={text}
            marks={marks}
            renderMark={(mark, content) =>
              mark.kind === "term" ? (
                <span className="existing-term-mark">{content}</span>
              ) : (
                <span
                  role="button"
                  tabIndex={0}
                  className="suggestion-mark"
                  data-suggestion={mark.suggestionId}
                  data-ordinal={mark.ordinal}
                  data-selected={focusId === mark.suggestionId}
                  title="Suggested term. Select it to decide."
                  onClick={() => {
                    onFocus({
                      suggestionId: mark.suggestionId,
                      index: mark.ordinal,
                      scroll: false,
                    });
                    globalThis.document
                      .getElementById(`suggestion-${mark.suggestionId}`)
                      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onFocus({
                        suggestionId: mark.suggestionId,
                        index: mark.ordinal,
                        scroll: false,
                      });
                    }
                  }}
                >
                  {content}
                </span>
              )
            }
          />
        </div>
      )}
    </Card>
  );
}

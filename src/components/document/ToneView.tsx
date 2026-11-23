"use client";

import Link from "next/link";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { KeyedMutator } from "swr";
import { useFeedback } from "@/components/feedback";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SparklesIcon,
  XIcon,
} from "@/components/icons";
import { MarkedText } from "@/components/MarkedText";
import { Badge, Button, Card, EmptyState, IconButton, Notice, cx } from "@/components/ui";
import { send } from "@/lib/client/api";
import { isTyping, modalOpen } from "@/lib/client/dom";
import type { AiToneResult, Annotation, DocumentDetail, Term, Tone } from "@/lib/client/types";
import { findOccurrences, spanKey, type Occurrence } from "@/lib/text/match";

const POPOVER_WIDTH = 304;

interface Props {
  document: DocumentDetail;
  terms: Term[];
  tones: Tone[];
  annotations: Annotation[];
  mutateAnnotations: KeyedMutator<Annotation[]>;
}

interface Selection {
  key: string;
  top: number;
  left: number;
}

export function ToneView({ document, terms, tones, annotations, mutateAnnotations }: Props) {
  const { notify, notifyError, confirm } = useFeedback();
  const container = useRef<HTMLDivElement>(null);
  const popover = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [termFilter, setTermFilter] = useState<number | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [bulk, setBulk] = useState<"suggest" | "confirm" | "discard" | null>(null);

  const occurrences = useMemo(() => findOccurrences(document.text, terms), [document.text, terms]);
  const byKey = useMemo(() => new Map(occurrences.map((o) => [spanKey(o), o])), [occurrences]);
  const annotationByKey = useMemo(
    () => new Map(annotations.map((annotation) => [spanKey(annotation), annotation])),
    [annotations],
  );
  const termById = useMemo(() => new Map(terms.map((term) => [term.id, term])), [terms]);
  const toneById = useMemo(() => new Map(tones.map((tone) => [tone.id, tone])), [tones]);
  const defaultTone = tones.find((tone) => tone.isDefault) ?? tones[0];

  const navigable = useMemo(
    () => (termFilter === null ? occurrences : occurrences.filter((o) => o.termId === termFilter)),
    [occurrences, termFilter],
  );
  const active = selection && byKey.has(selection.key) ? selection : null;
  const activeOccurrence = active ? byKey.get(active.key)! : null;
  const activeAnnotation = active ? annotationByKey.get(active.key) : undefined;

  const aiCount = annotations.filter(
    (annotation) => annotation.source === "ai" && byKey.has(spanKey(annotation)),
  ).length;
  const untagged = occurrences.filter((o) => !annotationByKey.has(spanKey(o))).length;

  const toneCounts = new Map<number, number>();
  const termCounts = new Map<number, number>();
  for (const occurrence of occurrences) {
    const toneId = annotationByKey.get(spanKey(occurrence))?.toneId ?? defaultTone?.id;
    if (toneId !== undefined) toneCounts.set(toneId, (toneCounts.get(toneId) ?? 0) + 1);
    termCounts.set(occurrence.termId, (termCounts.get(occurrence.termId) ?? 0) + 1);
  }

  function markElement(key: string): HTMLElement | null {
    return container.current?.querySelector<HTMLElement>(`[data-key="${key}"]`) ?? null;
  }

  function select(key: string | null, scroll = false) {
    const root = container.current;
    const element = key === null ? null : markElement(key);
    if (key === null || !root || !element) {
      setSelection(null);
      return;
    }
    // A mark that wraps has one box per line; the popover hangs off the last.
    const boxes = element.getClientRects();
    const box = boxes[boxes.length - 1] ?? element.getBoundingClientRect();
    const frame = root.getBoundingClientRect();
    setSelection({
      key,
      top: box.bottom - frame.top + 8,
      left: Math.max(0, Math.min(box.left - frame.left, frame.width - POPOVER_WIDTH)),
    });
    // Keyboard shortcuts act on the selected term, so focus follows it.
    element.focus({ preventScroll: true });
    if (scroll && (box.top < 96 || box.bottom > window.innerHeight - 380)) {
      element.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }

  function step(delta: 1 | -1) {
    if (navigable.length === 0) return;
    const index = active ? navigable.findIndex((o) => spanKey(o) === active.key) : -1;
    const next =
      index === -1
        ? delta === 1
          ? 0
          : navigable.length - 1
        : (index + delta + navigable.length) % navigable.length;
    select(spanKey(navigable[next]), true);
  }

  function nextUntagged() {
    const start = active ? navigable.findIndex((o) => spanKey(o) === active.key) + 1 : 0;
    const ordered = [...navigable.slice(start), ...navigable.slice(0, start)];
    const target = ordered.find((o) => annotationByKey.get(spanKey(o))?.source !== "user");
    if (target) select(spanKey(target), true);
    else notify("Every occurrence here has a tone you set or confirmed.");
  }

  async function applyTone(occurrence: Occurrence, toneId: number | null) {
    const key = spanKey(occurrence);
    const others = annotations.filter((annotation) => spanKey(annotation) !== key);
    const optimistic: Annotation[] =
      toneId === null
        ? others
        : [
            ...others,
            {
              id: annotationByKey.get(key)?.id ?? -occurrence.start - 1,
              documentId: document.id,
              termId: occurrence.termId,
              start: occurrence.start,
              end: occurrence.end,
              toneId,
              source: "user",
              reason: null,
            },
          ];
    void mutateAnnotations(optimistic, { revalidate: false });
    try {
      await send("PUT", `/api/documents/${document.id}/annotations`, {
        start: occurrence.start,
        end: occurrence.end,
        toneId,
      });
    } catch (error) {
      notifyError(error);
    }
  }

  async function askAi(occurrence: Occurrence) {
    const key = spanKey(occurrence);
    // Move focus off the button before it is disabled, or key presses are lost.
    markElement(key)?.focus({ preventScroll: true });
    setAsking(key);
    try {
      const result = await send<AiToneResult>("POST", `/api/documents/${document.id}/ai-tone`, {
        start: occurrence.start,
        end: occurrence.end,
      });
      if (result.suggested === 0) {
        notifyError("The AI did not give a usable answer for this occurrence. Try again.");
      }
    } catch (error) {
      notifyError(error);
    } finally {
      setAsking(null);
    }
  }

  async function suggestAll() {
    setBulk("suggest");
    try {
      const result = await send<AiToneResult>(
        "POST",
        `/api/documents/${document.id}/ai-tone`,
        {},
      );
      const parts = [
        `The AI suggested a tone for ${result.suggested} occurrence${result.suggested === 1 ? "" : "s"}.`,
      ];
      if (result.skipped > 0) parts.push(`${result.skipped} you had already set were left alone.`);
      if (result.missed > 0) parts.push(`${result.missed} got no usable answer.`);
      if (result.suggested > 0) parts.push("Review them, then confirm or change each one.");
      notify(parts.join(" "));
    } catch (error) {
      notifyError(error);
    } finally {
      setBulk(null);
    }
  }

  async function resolveSuggestions(action: "confirm" | "discard") {
    if (action === "discard") {
      const ok = await confirm({
        title: "Discard AI suggestions?",
        body: `${aiCount} unconfirmed AI suggestion${aiCount === 1 ? "" : "s"} will be removed and those occurrences return to the default tone. Tones you set yourself are kept.`,
        confirmLabel: "Discard suggestions",
        danger: true,
      });
      if (!ok) return;
    }
    setBulk(action);
    try {
      await send("POST", `/api/documents/${document.id}/annotations`, { action });
      notify(
        action === "confirm"
          ? `Confirmed ${aiCount} AI suggestion${aiCount === 1 ? "" : "s"}.`
          : `Discarded ${aiCount} AI suggestion${aiCount === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      notifyError(error);
    } finally {
      setBulk(null);
    }
  }

  const onKey = useEffectEvent((event: KeyboardEvent) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (isTyping(event.target) || modalOpen()) return;
    if (!activeOccurrence) {
      if (event.key === "n" || event.key === "N") {
        event.preventDefault();
        nextUntagged();
      }
      return;
    }
    const handled = () => event.preventDefault();
    if (event.key === "Escape") {
      handled();
      select(null);
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      handled();
      step(1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      handled();
      step(-1);
    } else if (/^[1-9]$/.test(event.key)) {
      const tone = tones[Number(event.key) - 1];
      if (!tone) return;
      handled();
      void applyTone(activeOccurrence, tone.id);
      step(1);
    } else if (event.key === "Enter" && activeAnnotation?.source === "ai") {
      // On a focused button or link, Enter belongs to that control.
      if (event.target instanceof Element && event.target.closest("button, a")) return;
      handled();
      void applyTone(activeOccurrence, activeAnnotation.toneId);
      step(1);
    } else if (event.key === "Backspace" || event.key === "Delete" || event.key === "0") {
      handled();
      if (activeAnnotation) void applyTone(activeOccurrence, null);
    } else if (event.key === "a" || event.key === "A") {
      handled();
      if (asking === null) void askAi(activeOccurrence);
    } else if (event.key === "n" || event.key === "N") {
      handled();
      nextUntagged();
    }
  });

  const onResize = useEffectEvent(() => {
    if (active) select(active.key);
  });

  useEffect(() => {
    const keyListener = (event: KeyboardEvent) => onKey(event);
    const resizeListener = () => onResize();
    window.addEventListener("keydown", keyListener);
    window.addEventListener("resize", resizeListener);
    return () => {
      window.removeEventListener("keydown", keyListener);
      window.removeEventListener("resize", resizeListener);
    };
  }, []);

  // Keep the picker on screen when it opens near the bottom of the window.
  const activeKey = active?.key;
  useEffect(() => {
    if (activeKey) popover.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeKey]);

  if (terms.length === 0) {
    return (
      <EmptyState
        title="No terms to highlight yet"
        action={
          <Link
            href="/terms"
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500"
          >
            Add terms
          </Link>
        }
      >
        Add the terms you want to analyse. Every place they appear in this document will be
        highlighted here so you can record its tone.
      </EmptyState>
    );
  }
  if (!defaultTone) {
    return <Notice tone="red">No tones are defined. Add at least one on the Tones page.</Notice>;
  }

  const activeIndex = active ? navigable.findIndex((o) => spanKey(o) === active.key) : -1;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_17rem]">
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Button variant="primary" busy={bulk === "suggest"} onClick={suggestAll}>
            {bulk === "suggest" ? (
              "Asking the AI…"
            ) : (
              <>
                <SparklesIcon /> Suggest tones with AI
              </>
            )}
          </Button>
          {aiCount > 0 ? (
            <>
              <Button busy={bulk === "confirm"} onClick={() => resolveSuggestions("confirm")}>
                <CheckIcon /> Confirm {aiCount} suggestion{aiCount === 1 ? "" : "s"}
              </Button>
              <Button
                variant="ghost"
                busy={bulk === "discard"}
                onClick={() => resolveSuggestions("discard")}
              >
                Discard suggestions
              </Button>
            </>
          ) : null}
          <Button variant="ghost" className="ml-auto" onClick={nextUntagged}>
            Next to review <ChevronRightIcon />
          </Button>
        </div>

        {occurrences.length === 0 ? (
          <div className="mb-3">
            <Notice>None of the terms on your list appear in this document.</Notice>
          </div>
        ) : null}

        <Card className="relative">
          {/* Clicking anywhere that is not a term closes the picker. */}
          <div
            ref={container}
            className="relative px-8 py-7"
            onClick={(event) => {
              const target = event.target as HTMLElement;
              if (!target.closest("[data-key], [data-popover]")) select(null);
            }}
          >
            <MarkedText
              text={document.text}
              marks={occurrences}
              renderMark={(occurrence, content) => {
                const key = spanKey(occurrence);
                const annotation = annotationByKey.get(key);
                const tone = (annotation && toneById.get(annotation.toneId)) || defaultTone;
                const state = !annotation ? "default" : annotation.source === "ai" ? "ai" : "user";
                const term = termById.get(occurrence.termId);
                return (
                  <span
                    role="button"
                    tabIndex={0}
                    data-key={key}
                    data-state={state}
                    data-selected={active?.key === key}
                    data-dimmed={termFilter !== null && occurrence.termId !== termFilter}
                    className="term-mark"
                    style={{ "--tone": tone.color } as React.CSSProperties}
                    title={`${term?.text ?? content}: ${tone.name}${
                      state === "ai"
                        ? " (suggested by AI, not confirmed)"
                        : state === "default"
                          ? " (default, not set)"
                          : ""
                    }`}
                    onClick={() => select(active?.key === key ? null : key)}
                    onKeyDown={(event) => {
                      // Once the picker is open, keys are shortcuts handled above.
                      if (active?.key === key) return;
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        event.stopPropagation();
                        select(key);
                      }
                    }}
                  >
                    {content}
                  </span>
                );
              }}
            />

            {active && activeOccurrence ? (
              <div
                ref={popover}
                data-popover
                role="dialog"
                aria-label="Choose a tone"
                className="absolute z-20 scroll-my-6 rounded-xl bg-white p-3 font-sans shadow-xl ring-1 ring-zinc-300"
                style={{ top: active.top, left: active.left, width: POPOVER_WIDTH }}
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-zinc-900">
                      “{document.text.slice(activeOccurrence.start, activeOccurrence.end)}”
                    </p>
                    <p className="text-xs text-zinc-500">
                      {activeIndex + 1} of {navigable.length}
                      {termFilter !== null ? " for this term" : " in this document"}
                    </p>
                  </div>
                  <IconButton label="Previous term" onClick={() => step(-1)}>
                    <ChevronLeftIcon />
                  </IconButton>
                  <IconButton label="Next term" onClick={() => step(1)}>
                    <ChevronRightIcon />
                  </IconButton>
                  <IconButton label="Close" onClick={() => select(null)}>
                    <XIcon />
                  </IconButton>
                </div>

                <div className="mt-2">
                  {!activeAnnotation ? (
                    <p className="text-xs text-zinc-500">
                      Not set yet, so it counts as {defaultTone.name}.
                    </p>
                  ) : activeAnnotation.source === "ai" ? (
                    <div className="rounded-md bg-indigo-50 px-2 py-1.5 text-xs leading-5 text-indigo-900">
                      <span className="font-semibold">AI suggestion, not confirmed.</span>{" "}
                      {activeAnnotation.reason}
                    </div>
                  ) : (
                    <p className="text-xs text-zinc-500">Set by you.</p>
                  )}
                </div>

                <ul className="mt-2 space-y-0.5">
                  {tones.map((tone, index) => {
                    const current = activeAnnotation?.toneId === tone.id;
                    return (
                      <li key={tone.id}>
                        <button
                          type="button"
                          aria-pressed={current}
                          onClick={() => {
                            void applyTone(activeOccurrence, tone.id);
                            markElement(active.key)?.focus({ preventScroll: true });
                            setSelection(null);
                          }}
                          className={cx(
                            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                            current ? "bg-zinc-100 font-semibold" : "hover:bg-zinc-50",
                          )}
                        >
                          <span
                            className="size-3 shrink-0 rounded-full"
                            style={{ background: tone.color }}
                          />
                          <span className="min-w-0 flex-1 truncate" style={{ color: tone.color }}>
                            {tone.name}
                          </span>
                          {current ? (
                            <span className="text-xs font-normal text-zinc-500">
                              {activeAnnotation?.source === "ai" ? "suggested" : "current"}
                            </span>
                          ) : null}
                          {index < 9 ? (
                            <kbd className="rounded border border-zinc-200 bg-zinc-50 px-1.5 font-mono text-[11px] text-zinc-500">
                              {index + 1}
                            </kbd>
                          ) : null}
                        </button>
                      </li>
                    );
                  })}
                </ul>

                <div className="mt-2 flex items-center gap-2 border-t border-zinc-100 pt-2">
                  <Button
                    size="sm"
                    busy={asking === active.key}
                    disabled={asking !== null}
                    onClick={() => askAi(activeOccurrence)}
                  >
                    {asking === active.key ? (
                      "Asking…"
                    ) : (
                      <>
                        <SparklesIcon /> Ask AI
                      </>
                    )}
                  </Button>
                  {activeAnnotation?.source === "ai" ? (
                    <Button
                      size="sm"
                      onClick={() => void applyTone(activeOccurrence, activeAnnotation.toneId)}
                    >
                      <CheckIcon /> Confirm
                    </Button>
                  ) : null}
                  {activeAnnotation ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto"
                      onClick={() => void applyTone(activeOccurrence, null)}
                    >
                      Clear
                    </Button>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      <aside className="space-y-4 lg:sticky lg:top-6 lg:self-start">
        <Card className="p-4">
          <h2 className="text-sm font-semibold text-zinc-900">Tones</h2>
          <ul className="mt-2 space-y-1.5">
            {tones.map((tone, index) => (
              <li key={tone.id} className="flex items-center gap-2 text-sm">
                <kbd className="w-5 rounded border border-zinc-200 bg-zinc-50 text-center font-mono text-[11px] text-zinc-500">
                  {index < 9 ? index + 1 : ""}
                </kbd>
                <span className="size-3 shrink-0 rounded-full" style={{ background: tone.color }} />
                <span className="min-w-0 flex-1 truncate font-medium" style={{ color: tone.color }}>
                  {tone.name}
                </span>
                <span className="text-zinc-600 tabular-nums">{toneCounts.get(tone.id) ?? 0}</span>
              </li>
            ))}
          </ul>
          <div className="mt-3 space-y-1 border-t border-zinc-100 pt-3 text-xs text-zinc-600">
            <p>
              {occurrences.length} occurrence{occurrences.length === 1 ? "" : "s"} in total
            </p>
            <p>
              {untagged} not set (counted as {defaultTone.name})
            </p>
            {aiCount > 0 ? (
              <p>
                <Badge tone="indigo">{aiCount} AI suggestions to confirm</Badge>
              </p>
            ) : null}
          </div>
        </Card>

        <Card className="p-4">
          <h2 className="text-sm font-semibold text-zinc-900">Terms in this document</h2>
          <p className="mt-1 text-xs text-zinc-500">Choose a term to focus on it.</p>
          <ul className="mt-2 space-y-0.5">
            {terms
              .filter((term) => termCounts.has(term.id))
              .sort((a, b) => (termCounts.get(b.id) ?? 0) - (termCounts.get(a.id) ?? 0))
              .map((term) => (
                <li key={term.id}>
                  <button
                    type="button"
                    aria-pressed={termFilter === term.id}
                    onClick={() => {
                      setTermFilter(termFilter === term.id ? null : term.id);
                      select(null);
                    }}
                    className={cx(
                      "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-sm",
                      termFilter === term.id
                        ? "bg-indigo-50 font-semibold text-indigo-800"
                        : "text-zinc-700 hover:bg-zinc-50",
                    )}
                  >
                    <span className="truncate">{term.text}</span>
                    <span className="tabular-nums">{termCounts.get(term.id)}</span>
                  </button>
                </li>
              ))}
          </ul>
          {termFilter !== null ? (
            <Button size="sm" variant="ghost" className="mt-2" onClick={() => setTermFilter(null)}>
              Show all terms
            </Button>
          ) : null}
        </Card>

        <Card className="p-4 text-xs leading-5 text-zinc-600">
          <h2 className="text-sm font-semibold text-zinc-900">Keyboard</h2>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
            <dt className="font-mono text-zinc-500">1–{Math.min(9, tones.length)}</dt>
            <dd>Set the tone and move on</dd>
            <dt className="font-mono text-zinc-500">← →</dt>
            <dd>Previous or next term</dd>
            <dt className="font-mono text-zinc-500">N</dt>
            <dd>Next term still to review</dd>
            <dt className="font-mono text-zinc-500">Enter</dt>
            <dd>Confirm an AI suggestion</dd>
            <dt className="font-mono text-zinc-500">A</dt>
            <dd>Ask the AI about this term</dd>
            <dt className="font-mono text-zinc-500">0</dt>
            <dd>Clear back to the default</dd>
            <dt className="font-mono text-zinc-500">Esc</dt>
            <dd>Close the picker</dd>
          </dl>
        </Card>
      </aside>
    </div>
  );
}

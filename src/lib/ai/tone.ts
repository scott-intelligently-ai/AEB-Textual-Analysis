import { choice } from "@typesafe-ai/sdk";
import type { Span } from "../text/documents";
import { askJev, type JevRequest } from "./jev";
import { mapLimit } from "./models";

export interface ToneOption {
  id: number;
  name: string;
  score: number;
  isDefault: boolean;
  definition?: string | null;
}

export interface ToneSuggestion extends Span {
  toneId: number;
  reason: string;
}

export interface ToneRequest {
  passageStart: number;
  passageEnd: number;
  targets: Span[];
}

export interface PlanOptions {
  /** Longest stretch of text between the first and last target of one request. */
  maxSpan: number;
  maxTargets: number;
  /** Text shown on either side of the targets so each can be judged in context. */
  context: number;
}

const DEFAULT_PLAN: PlanOptions = { maxSpan: 8000, maxTargets: 40, context: 1200 };

/** Moves a passage start forward to the nearest clean break before `limit`. */
function snapStart(text: string, from: number, limit: number): number {
  if (from <= 0) return 0;
  const window = text.slice(from, limit);
  const paragraph = window.indexOf("\n");
  if (paragraph !== -1) return from + paragraph + 1;
  const sentence = window.search(/[.!?]\s/);
  if (sentence !== -1) return from + sentence + 2;
  const space = window.search(/\s/);
  return space !== -1 ? from + space + 1 : from;
}

/** Moves a passage end back to the nearest clean break after `limit`. */
function snapEnd(text: string, to: number, limit: number): number {
  if (to >= text.length) return text.length;
  const window = text.slice(limit, to);
  const paragraph = window.lastIndexOf("\n");
  if (paragraph !== -1) return limit + paragraph;
  const sentences = [...window.matchAll(/[.!?](?=\s)/g)];
  if (sentences.length > 0) return limit + sentences[sentences.length - 1].index + 1;
  const space = window.search(/\s\S*$/);
  return space !== -1 ? limit + space : to;
}

/**
 * Groups occurrences into requests. Each request carries a passage that holds
 * its targets plus surrounding context, so long documents are judged in
 * overlapping windows rather than all at once.
 */
/** Jev calls one web request may make before the host stops it. */
export const JEV_CALLS_PER_REQUEST = 8;

/**
 * The first Jev calls for these occurrences, and how many occurrences are left
 * for a later request. `after` is the start of the last occurrence in this batch.
 */
export function takeToneBatch<T extends Span>(
  text: string,
  targets: T[],
  calls = JEV_CALLS_PER_REQUEST,
): { batch: T[]; remaining: number; after?: number } {
  if (targets.length === 0 || calls <= 0) return { batch: [], remaining: targets.length };
  const planned = planToneRequests(text, targets);
  const batch = planned.slice(0, calls).flatMap((request) => request.targets) as T[];
  const after = batch.reduce((latest, target) => Math.max(latest, target.start), -1);
  return {
    batch,
    remaining: targets.length - batch.length,
    ...(after >= 0 ? { after } : {}),
  };
}

export function planToneRequests(
  text: string,
  targets: Span[],
  options: Partial<PlanOptions> = {},
): ToneRequest[] {
  const { maxSpan, maxTargets, context } = { ...DEFAULT_PLAN, ...options };
  const sorted = [...targets].sort((a, b) => a.start - b.start);
  const groups: Span[][] = [];
  for (const target of sorted) {
    const group = groups[groups.length - 1];
    if (group && group.length < maxTargets && target.end - group[0].start <= maxSpan) {
      group.push(target);
    } else {
      groups.push([target]);
    }
  }
  return groups.map((group) => {
    const first = group[0].start;
    const last = group[group.length - 1].end;
    return {
      passageStart: snapStart(text, Math.max(0, first - context), first),
      passageEnd: snapEnd(text, Math.min(text.length, last + context), last),
      targets: group,
    };
  });
}

/** Renders a passage with each target wrapped as <term n="1">…</term>. */
export function markPassage(text: string, request: ToneRequest): string {
  let out = "";
  let cursor = request.passageStart;
  request.targets.forEach((target, i) => {
    out += text.slice(cursor, target.start);
    out += `<term n="${i + 1}">${text.slice(target.start, target.end)}</term>`;
    cursor = target.end;
  });
  return out + text.slice(cursor, request.passageEnd);
}

/**
 * A Choice always names a winner. Keep the tone only when Jev's probability
 * for that winner is at least this. Below it, the occurrence stays unset.
 */
export const TONE_SETTLED_AT = 0.7;

/** Labels are the tone names. A blank definition is left undescribed. */
export function toneCriteria(tones: ToneOption[]): Record<string, string | null> {
  return Object.fromEntries(tones.map((tone) => [tone.name, tone.definition?.trim() || null]));
}

/**
 * Question keys are not shown to Jev. The number in the instruction is the
 * same number `markPassage` writes on the term, and backticks name state fields.
 */
export function occurrenceInstructions(n: number, hasPurpose: boolean): string {
  const purpose = hasPurpose ? " The purpose of the analysis is in `purpose`." : "";
  return `In \`passage\`, what attitude does the speaker express toward what the term marked <term n="${n}"> refers to, at that point? Judge that one marked place from the surrounding sentences. The usual meaning of the word is not the attitude.${purpose}`;
}

/** The tone id when this Choice is settled, or null when it should be left unset. */
export function settledToneId(answer: unknown, tones: ToneOption[]): number | null {
  if (!answer || typeof answer !== "object") return null;
  const { choice: selected, probabilities } = answer as {
    choice?: unknown;
    probabilities?: unknown;
  };
  if (typeof selected !== "string") return null;
  if (!probabilities || typeof probabilities !== "object") return null;
  const probability = (probabilities as Record<string, unknown>)[selected];
  if (typeof probability !== "number" || probability < TONE_SETTLED_AT) return null;
  return tones.find((tone) => tone.name === selected)?.id ?? null;
}

export interface SuggestTonesArgs {
  text: string;
  targets: Span[];
  tones: ToneOption[];
  purpose?: string;
  /** More context is affordable when only one occurrence is being judged. */
  plan?: Partial<PlanOptions>;
  /** Test seam. The default sends the request to Jev. */
  ask?: (request: JevRequest) => Promise<Record<string, unknown>>;
}

export interface SuggestTonesResult {
  suggestions: ToneSuggestion[];
  /** Targets the model returned no usable answer for. */
  missed: number;
}

export async function suggestTones({
  text,
  targets,
  tones,
  purpose,
  plan,
  ask = askJev,
}: SuggestTonesArgs): Promise<SuggestTonesResult> {
  if (targets.length === 0) return { suggestions: [], missed: 0 };
  if (tones.length === 0) throw new Error("Define at least one tone first.");

  const purposeText = purpose?.trim() ?? "";
  const hasPurpose = purposeText.length > 0;
  const criteria = toneCriteria(tones);
  const requests = planToneRequests(text, targets, plan);
  const batches = await mapLimit(requests, 4, async (request) => {
    const questions: JevRequest["questions"] = {};
    request.targets.forEach((_, index) => {
      const n = index + 1;
      questions[`occurrence_${n}`] = choice(occurrenceInstructions(n, hasPurpose), criteria);
    });
    const state: Record<string, string> = { passage: markPassage(text, request) };
    if (hasPurpose) state.purpose = purposeText;
    const answers = await ask({ state, questions });
    const found: ToneSuggestion[] = [];
    request.targets.forEach((target, index) => {
      const toneId = settledToneId(answers[`occurrence_${index + 1}`], tones);
      if (toneId === null) return;
      found.push({ start: target.start, end: target.end, toneId, reason: "" });
    });
    return found;
  });

  const suggestions = batches.flat();
  return { suggestions, missed: targets.length - suggestions.length };
}

import { generateText, Output } from "ai";
import { z } from "zod";
import type { Span } from "../text/documents";
import { languageModel, mapLimit, type Provider } from "./models";

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

const toneKey = (tone: ToneOption) => `tone_${tone.id}`;

function instructions(tones: ToneOption[]): string {
  const fallback = tones.find((tone) => tone.isDefault) ?? tones[0];
  const list = tones
    .map((tone) => {
      const meaning = tone.definition?.trim();
      const line = `- ${toneKey(tone)}: ${tone.name} (score ${tone.score})`;
      return meaning ? `${line}. ${meaning}` : line;
    })
    .join("\n");
  return `You help a researcher analyse the text of speeches. Certain terms in a passage are marked like <term n="3">taxes</term>.

For each marked term, choose the tone with which the speaker uses it at that point: the attitude the speaker expresses toward what the term refers to. Judge from the surrounding sentences, not from the usual connotation of the word. Judge every occurrence on its own; the same term can carry different tones in different places. Choose "${fallback.name}" when the passage is merely descriptive or gives no clear signal.

The tones, which are the only permitted answers:
${list}

Return one result for every marked term: its number, the tone key, and a reason of at most 15 words that points to the wording that decided it.`;
}

export interface SuggestTonesArgs {
  provider: Provider;
  text: string;
  targets: Span[];
  tones: ToneOption[];
  purpose?: string;
  /** More context is affordable when only one occurrence is being judged. */
  plan?: Partial<PlanOptions>;
}

export interface SuggestTonesResult {
  suggestions: ToneSuggestion[];
  /** Targets the model returned no usable answer for. */
  missed: number;
}

export async function suggestTones({
  provider,
  text,
  targets,
  tones,
  purpose,
  plan,
}: SuggestTonesArgs): Promise<SuggestTonesResult> {
  if (targets.length === 0) return { suggestions: [], missed: 0 };
  if (tones.length === 0) throw new Error("Define at least one tone first.");

  const byKey = new Map(tones.map((tone) => [toneKey(tone), tone.id]));
  const keys = tones.map(toneKey) as [string, ...string[]];
  const schema = z.object({
    results: z.array(
      z.object({
        n: z.number().int().describe("Number of the marked term"),
        tone: z.enum(keys),
        reason: z.string(),
      }),
    ),
  });
  const model = languageModel(provider, "analysis");
  const system = instructions(tones);
  const preamble = purpose?.trim()
    ? `Purpose of the analysis, as described by the researcher:\n${purpose.trim()}\n\n`
    : "";

  const requests = planToneRequests(text, targets, plan);
  const batches = await mapLimit(requests, 4, async (request) => {
    const { output } = await generateText({
      model,
      instructions: system,
      output: Output.object({ schema }),
      maxRetries: 3,
      prompt: `${preamble}Passage:\n${markPassage(text, request)}`,
    });
    const found = new Map<number, ToneSuggestion>();
    for (const result of output.results) {
      const target = request.targets[result.n - 1];
      const toneId = byKey.get(result.tone);
      if (!target || toneId === undefined || found.has(result.n)) continue;
      found.set(result.n, {
        start: target.start,
        end: target.end,
        toneId,
        reason: result.reason.trim(),
      });
    }
    return [...found.values()];
  });

  const suggestions = batches.flat();
  return { suggestions, missed: targets.length - suggestions.length };
}

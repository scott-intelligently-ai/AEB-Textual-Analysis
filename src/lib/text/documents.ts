/**
 * Pure text operations for combining, splitting, and editing documents while
 * keeping character-offset annotations attached to the words they describe.
 */

import { buildMatcher, spanKey, type TermPattern } from "./match";

export interface Span {
  start: number;
  end: number;
}

export interface TermSpan extends Span {
  termId: number;
}

/** Separator placed between the texts of combined documents and pages. */
export const JOINER = "\n\n";

/**
 * Joins the transcriptions of consecutive pages. A page that stops mid-sentence
 * runs straight on into the next one, so sentences are not broken into separate
 * paragraphs at every page turn; a page that ends a sentence is followed by a
 * paragraph break.
 */
export function joinPages(texts: string[]): string {
  let out = "";
  for (const raw of texts) {
    const text = raw.trim();
    if (text.length === 0) continue;
    if (out.length === 0) {
      out = text;
    } else if (/[.!?]["'\u201d\u2019)\]]*$/.test(out)) {
      out += JOINER + text;
    } else if (/\p{L}-$/u.test(out)) {
      out += text;
    } else {
      out += ` ${text}`;
    }
  }
  return out;
}

export interface TextPart<T extends Span> {
  text: string;
  spans: T[];
}

/** Concatenates parts in order, shifting each part's spans to its new position. */
export function combineParts<T extends Span>(parts: TextPart<T>[]): TextPart<T> {
  let text = "";
  const spans: T[] = [];
  for (const part of parts) {
    const leading = part.text.length - part.text.trimStart().length;
    const body = part.text.trim();
    if (body.length === 0) continue;
    if (text.length > 0) text += JOINER;
    const shift = text.length - leading;
    for (const span of part.spans) {
      if (span.start < leading || span.end > leading + body.length) continue;
      spans.push({ ...span, start: span.start + shift, end: span.end + shift });
    }
    text += body;
  }
  return { text, spans };
}

export interface SplitResult<T extends Span> {
  first: TextPart<T>;
  second: TextPart<T>;
  /** Spans that straddled the cut and belong to neither half. */
  dropped: T[];
}

/**
 * Cuts text at a character offset. Whitespace around the cut is trimmed, so the
 * second half starts at its first visible character.
 */
export function splitPart<T extends Span>(
  text: string,
  spans: T[],
  offset: number,
): SplitResult<T> {
  if (!Number.isInteger(offset) || offset <= 0 || offset >= text.length) {
    throw new RangeError("The split point must be inside the document.");
  }
  const firstText = text.slice(0, offset).trimEnd();
  const rest = text.slice(offset);
  const secondText = rest.trim();
  if (firstText.trim().length === 0 || secondText.length === 0) {
    throw new RangeError("Both parts of a split must contain text.");
  }
  const secondStart = offset + (rest.length - rest.trimStart().length);

  const first: T[] = [];
  const second: T[] = [];
  const dropped: T[] = [];
  for (const span of spans) {
    if (span.end <= firstText.length) {
      first.push(span);
    } else if (span.start >= secondStart && span.end <= secondStart + secondText.length) {
      second.push({
        ...span,
        start: span.start - secondStart,
        end: span.end - secondStart,
      });
    } else {
      dropped.push(span);
    }
  }
  return {
    first: { text: firstText, spans: first },
    second: { text: secondText, spans: second },
    dropped,
  };
}

export interface EditRegion {
  /** Offset where the old and new text first differ. */
  start: number;
  /** End of the replaced region in the old text. */
  oldEnd: number;
  /** End of the replacement in the new text. */
  newEnd: number;
}

/** Smallest single replaced region that turns oldText into newText. */
export function editRegion(oldText: string, newText: string): EditRegion {
  const max = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < max && oldText[prefix] === newText[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < max - prefix &&
    oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    start: prefix,
    oldEnd: oldText.length - suffix,
    newEnd: newText.length - suffix,
  };
}

export interface RebaseResult<T extends Span> {
  kept: T[];
  dropped: T[];
}

/**
 * Carries spans across a text edit. Spans before the edited region stay put,
 * spans after it shift, and spans touching it are dropped. When terms are
 * given, a span is also dropped if it no longer lines up with an occurrence of
 * its term (for example when "tax" was edited into "taxes").
 */
export function rebaseSpans<T extends TermSpan>(
  oldText: string,
  newText: string,
  spans: T[],
  terms?: TermPattern[],
): RebaseResult<T> {
  const region = editRegion(oldText, newText);
  const delta = newText.length - oldText.length;
  const kept: T[] = [];
  const dropped: T[] = [];

  for (const span of spans) {
    if (span.end <= region.start) {
      kept.push(span);
    } else if (span.start >= region.oldEnd) {
      kept.push({ ...span, start: span.start + delta, end: span.end + delta });
    } else {
      dropped.push(span);
    }
  }
  if (!terms) return { kept, dropped };

  const live = new Map(
    buildMatcher(terms)
      .find(newText)
      .map((occurrence) => [spanKey(occurrence), occurrence.termId]),
  );
  const stillMatching: T[] = [];
  for (const span of kept) {
    if (live.get(spanKey(span)) === span.termId) stillMatching.push(span);
    else dropped.push(span);
  }
  return { kept: stillMatching, dropped };
}

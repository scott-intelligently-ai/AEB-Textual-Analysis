/** Markers the OCR step leaves in a transcription for the reviewer to resolve. */
export const ILLEGIBLE_MARK = "[illegible]";
export const UNSURE_MARK = "[?]";

/** Normalises line endings and blank lines without touching the words. */
export function cleanTranscription(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function countUncertain(text: string): number {
  return text.split(ILLEGIBLE_MARK).length + text.split(UNSURE_MARK).length - 2;
}

/** The first marker at or after `from`, wrapping round to the start of the text. */
export function nextUncertain(
  text: string,
  from: number,
): { start: number; end: number } | null {
  const search = (offset: number) => {
    let best: { start: number; end: number } | null = null;
    for (const mark of [UNSURE_MARK, ILLEGIBLE_MARK]) {
      const at = text.indexOf(mark, offset);
      if (at !== -1 && (best === null || at < best.start)) {
        best = { start: at, end: at + mark.length };
      }
    }
    return best;
  };
  return search(Math.max(0, from)) ?? search(0);
}

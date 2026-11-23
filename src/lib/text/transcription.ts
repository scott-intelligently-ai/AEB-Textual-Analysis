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

/**
 * Selects a range in a textarea and scrolls it into view. Browsers do not
 * scroll a textarea to a programmatic selection, so the text is cut short at
 * the target for a moment to measure how far down the target sits.
 */
export function revealSelection(field: HTMLTextAreaElement, start: number, end: number): void {
  const full = field.value;
  field.value = full.slice(0, end);
  const height = field.scrollHeight;
  field.value = full;
  field.scrollTop = height <= field.clientHeight ? 0 : height - field.clientHeight / 2;
  field.focus();
  field.setSelectionRange(start, end);
}

export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

export function modalOpen(): boolean {
  return document.querySelector("dialog[open]") !== null;
}

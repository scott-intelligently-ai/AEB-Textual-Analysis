import { Fragment, type ReactNode } from "react";

export interface TextMark {
  start: number;
  end: number;
}

interface Props<M extends TextMark> {
  text: string;
  /** Non-overlapping marks; any order. Overlapping marks after the first are skipped. */
  marks: M[];
  renderMark: (mark: M, content: string) => ReactNode;
  className?: string;
}

/** Renders text with some character ranges replaced by custom elements. */
export function MarkedText<M extends TextMark>({ text, marks, renderMark, className }: Props<M>) {
  const sorted = [...marks].sort((a, b) => a.start - b.start || b.end - a.end);
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const mark of sorted) {
    if (mark.start < cursor || mark.end > text.length || mark.end <= mark.start) continue;
    if (mark.start > cursor) parts.push(text.slice(cursor, mark.start));
    parts.push(
      <Fragment key={`${mark.start}:${mark.end}`}>
        {renderMark(mark, text.slice(mark.start, mark.end))}
      </Fragment>,
    );
    cursor = mark.end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <div className={`document-text ${className ?? ""}`}>{parts}</div>;
}

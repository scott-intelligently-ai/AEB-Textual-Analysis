export type TermSort = "alpha" | "count";

interface ListedTerm {
  id: number;
  text: string;
  variants: string[];
}

/**
 * Terms that appear in a document, ready for the tone sidebar.
 * Search ignores case and spaces at either end of the query or the term.
 */
export function documentTermList<T extends ListedTerm>(
  terms: T[],
  counts: Map<number, number>,
  query: string,
  sort: TermSort,
): T[] {
  const needle = query.trim().toLowerCase();
  return terms
    .filter((term) => counts.has(term.id))
    .filter((term) => {
      if (!needle) return true;
      return [term.text, ...term.variants].some((value) =>
        value.trim().toLowerCase().includes(needle),
      );
    })
    .sort((a, b) => {
      const byName = a.text.trim().localeCompare(b.text.trim(), undefined, { sensitivity: "base" });
      if (sort === "alpha") return byName || a.id - b.id;
      return (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0) || byName;
    });
}

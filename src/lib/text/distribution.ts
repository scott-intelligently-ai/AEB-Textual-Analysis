/**
 * Counts how occurrences are spread across tones. The same occurrences can be
 * grouped by term, by equivalence, by category, by subcategory, by document,
 * or as one overall total. A term in several categories is counted in each.
 */

export type DistributionGroup =
  | "term"
  | "equivalence"
  | "category"
  | "subcategory"
  | "document"
  | "overall";

export const DISTRIBUTION_GROUPS: DistributionGroup[] = [
  "term",
  "equivalence",
  "category",
  "subcategory",
  "document",
  "overall",
];

export interface DistributionTone {
  id: number;
  name: string;
  sortOrder: number;
}

export interface DistributionOccurrence {
  documentId: number;
  termId: number;
  toneId: number;
}

export interface DistributionTerm {
  id: number;
  text: string;
  equivalenceId: number | null;
}

export interface DistributionEquivalence {
  id: number;
  name: string;
}

export interface DistributionCategory {
  id: number;
  name: string;
  parentId: number | null;
}

export interface DistributionDocument {
  id: number;
  title: string;
}

export interface DistributionRow {
  id: string;
  label: string;
  counts: number[];
  total: number;
}

export interface ToneDistribution {
  group: DistributionGroup;
  tones: { id: number; name: string }[];
  rows: DistributionRow[];
}

const byLabel = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

export function buildToneDistribution(input: {
  group: DistributionGroup;
  tones: DistributionTone[];
  occurrences: DistributionOccurrence[];
  terms: DistributionTerm[];
  equivalences: DistributionEquivalence[];
  categories: DistributionCategory[];
  memberships: { termId: number; categoryId: number }[];
  documents: DistributionDocument[];
  documentIds?: number[];
}): ToneDistribution {
  const tones = [...input.tones].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const toneIds = tones.map((tone) => tone.id);
  const allowed = input.documentIds ? new Set(input.documentIds) : null;
  const documents = input.documents.filter((document) => !allowed || allowed.has(document.id));
  const occurrences = input.occurrences.filter(
    (occurrence) => !allowed || allowed.has(occurrence.documentId),
  );

  const buckets = new Map<string, { id: string; label: string; counts: Map<number, number> }>();
  const ensure = (id: string, label: string) => {
    let bucket = buckets.get(id);
    if (!bucket) {
      bucket = { id, label, counts: new Map() };
      buckets.set(id, bucket);
    }
    return bucket;
  };
  const add = (id: string, label: string, toneId: number) => {
    const bucket = ensure(id, label);
    bucket.counts.set(toneId, (bucket.counts.get(toneId) ?? 0) + 1);
  };

  const categories = input.categories;
  const childrenOf = new Map<number, number[]>();
  for (const category of categories) {
    if (category.parentId === null) continue;
    const children = childrenOf.get(category.parentId) ?? [];
    children.push(category.id);
    childrenOf.set(category.parentId, children);
  }
  const assignedTo = new Map<number, Set<number>>();
  for (const membership of input.memberships) {
    const set = assignedTo.get(membership.termId) ?? new Set();
    set.add(membership.categoryId);
    assignedTo.set(membership.termId, set);
  }
  const termById = new Map(input.terms.map((term) => [term.id, term]));
  const equivalenceById = new Map(input.equivalences.map((group) => [group.id, group]));
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const documentById = new Map(documents.map((document) => [document.id, document]));

  if (input.group === "term") {
    for (const term of input.terms) ensure(`term:${term.id}`, term.text);
  } else if (input.group === "equivalence") {
    for (const group of input.equivalences) ensure(`equivalence:${group.id}`, group.name);
    for (const term of input.terms) {
      if (term.equivalenceId === null) ensure(`term:${term.id}`, term.text);
    }
  } else if (input.group === "category") {
    for (const category of categories) {
      if (category.parentId === null) ensure(`category:${category.id}`, category.name);
    }
  } else if (input.group === "subcategory") {
    for (const category of categories) {
      if (category.parentId === null) continue;
      const parent = categoryById.get(category.parentId);
      ensure(
        `subcategory:${category.id}`,
        parent ? `${parent.name} / ${category.name}` : category.name,
      );
    }
  } else if (input.group === "document") {
    for (const document of documents) ensure(`document:${document.id}`, document.title);
  } else {
    ensure("overall", "Overall");
  }

  for (const occurrence of occurrences) {
    const term = termById.get(occurrence.termId);
    if (!term) continue;
    if (input.group === "term") {
      add(`term:${term.id}`, term.text, occurrence.toneId);
    } else if (input.group === "equivalence") {
      if (term.equivalenceId === null) add(`term:${term.id}`, term.text, occurrence.toneId);
      else {
        const group = equivalenceById.get(term.equivalenceId);
        add(
          `equivalence:${term.equivalenceId}`,
          group?.name ?? "Equivalent terms",
          occurrence.toneId,
        );
      }
    } else if (input.group === "category") {
      const assigned = assignedTo.get(term.id) ?? new Set<number>();
      for (const category of categories) {
        if (category.parentId !== null) continue;
        const inCategory =
          assigned.has(category.id) ||
          (childrenOf.get(category.id) ?? []).some((childId) => assigned.has(childId));
        if (inCategory) add(`category:${category.id}`, category.name, occurrence.toneId);
      }
    } else if (input.group === "subcategory") {
      const assigned = assignedTo.get(term.id) ?? new Set<number>();
      for (const categoryId of assigned) {
        const category = categoryById.get(categoryId);
        if (!category || category.parentId === null) continue;
        const parent = categoryById.get(category.parentId);
        add(
          `subcategory:${category.id}`,
          parent ? `${parent.name} / ${category.name}` : category.name,
          occurrence.toneId,
        );
      }
    } else if (input.group === "document") {
      const document = documentById.get(occurrence.documentId);
      if (!document) continue;
      add(`document:${document.id}`, document.title, occurrence.toneId);
    } else {
      add("overall", "Overall", occurrence.toneId);
    }
  }

  const rows = [...buckets.values()]
    .map((bucket) => {
      const counts = toneIds.map((id) => bucket.counts.get(id) ?? 0);
      return {
        id: bucket.id,
        label: bucket.label,
        counts,
        total: counts.reduce((sum, count) => sum + count, 0),
      };
    })
    .sort((a, b) => byLabel.compare(a.label, b.label) || a.id.localeCompare(b.id));

  return {
    group: input.group,
    tones: tones.map((tone) => ({ id: tone.id, name: tone.name })),
    rows,
  };
}

const CSV_HEADERS: Record<DistributionGroup, string> = {
  term: "term",
  equivalence: "equivalent_terms",
  category: "category",
  subcategory: "subcategory",
  document: "document",
  overall: "scope",
};

export function distributionCsv(distribution: ToneDistribution): (string | number)[][] {
  return [
    [CSV_HEADERS[distribution.group], ...distribution.tones.map((tone) => tone.name), "total"],
    ...distribution.rows.map((row) => [row.label, ...row.counts, row.total]),
  ];
}

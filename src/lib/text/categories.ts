/** A category, or a subcategory when parentId is set. */
export interface NamedCategory {
  id: number;
  name: string;
  parentId: number | null;
}

/** The name shown for a category. A subcategory includes its parent. */
export function categoryPath(category: NamedCategory, categories: NamedCategory[]): string {
  if (category.parentId === null) return category.name;
  const parent = categories.find((item) => item.id === category.parentId);
  return parent ? `${parent.name} / ${category.name}` : category.name;
}

/**
 * Every category assigned to a term, in a stable order. Several categories are
 * separated by a semicolon so a subcategory's own slash stays readable.
 */
export function formatTermCategories(categoryIds: Iterable<number>, categories: NamedCategory[]): string {
  const byId = new Map(categories.map((category) => [category.id, category]));
  const seen = new Set<number>();
  const labels: string[] = [];
  for (const id of categoryIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    const category = byId.get(id);
    if (category) labels.push(categoryPath(category, categories));
  }
  labels.sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
  return labels.join("; ");
}

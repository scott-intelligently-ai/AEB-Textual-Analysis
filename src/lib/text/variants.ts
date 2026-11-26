/** The term, then each of its variants, separated by slashes. */
export function formatTermWithVariants(text: string, variants: readonly string[] = []): string {
  return [text, ...variants.map((variant) => variant.trim()).filter(Boolean)].join(" / ");
}

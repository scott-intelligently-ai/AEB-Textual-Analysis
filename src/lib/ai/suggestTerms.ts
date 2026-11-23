import { generateText, Output } from "ai";
import { z } from "zod";
import { normalizeTerm } from "../text/match";
import { languageModel, mapLimit, type Provider } from "./models";

export interface SourceDocument {
  title: string;
  text: string;
}

export interface TermCandidate {
  term: string;
  reason: string;
  /** How many batches of documents proposed this term independently. */
  votes: number;
}

const MAX_BATCH_CHARS = 30000;
const MAX_PER_BATCH = 12;

/** Breaks one long text into pieces no longer than `max`, at paragraph breaks where possible. */
export function splitLongText(text: string, max: number): string[] {
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    let cut = window.lastIndexOf("\n");
    if (cut < max / 2) cut = window.lastIndexOf(" ");
    if (cut < max / 2) cut = max;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest.length > 0) pieces.push(rest);
  return pieces;
}

/** Packs documents into batches that each fit in one request. */
export function batchDocuments(
  documents: SourceDocument[],
  max: number = MAX_BATCH_CHARS,
): SourceDocument[][] {
  const batches: SourceDocument[][] = [];
  let current: SourceDocument[] = [];
  let size = 0;
  for (const document of documents) {
    const pieces = splitLongText(document.text.trim(), max);
    pieces.forEach((text, i) => {
      const title =
        pieces.length > 1 ? `${document.title} (part ${i + 1} of ${pieces.length})` : document.title;
      if (current.length > 0 && size + text.length > max) {
        batches.push(current);
        current = [];
        size = 0;
      }
      current.push({ title, text });
      size += text.length;
    });
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

const INSTRUCTIONS = `You help a researcher who analyses the text of speeches by counting how often chosen terms appear and judging the tone of each use. The researcher describes the purpose of the analysis and lists the terms already chosen. Read the documents and identify terms the researcher may have overlooked or underappreciated: words or short phrases that occur in the documents, matter for the stated purpose, and are missing from the list.

Guidance:
- Propose only words or phrases of one to four words that appear verbatim in the documents, copied exactly as they appear.
- Counting is exact, so a different form of a listed term, such as a plural, is worth proposing when the documents use it.
- Favour terms that carry the speaker's argument on the subject of the analysis, such as recurring concepts, loaded or euphemistic wording, and the names of policies, groups, or opponents, over generic vocabulary.
- Do not propose anything on the current list or the rejected list.
- Propose at most ${MAX_PER_BATCH} terms, the most valuable first. Propose fewer, or none, when little is missing.
- For each term give a reason of at most 25 words saying why it matters for this analysis.`;

const schema = z.object({
  suggestions: z.array(z.object({ term: z.string(), reason: z.string() })),
});

function bulletList(items: string[]): string {
  return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : "(none)";
}

export interface SuggestTermsArgs {
  provider: Provider;
  purpose: string;
  existingTerms: string[];
  rejectedTerms: string[];
  documents: SourceDocument[];
}

/**
 * Asks the model for candidate terms. Callers must still check that each
 * candidate really occurs in the documents; the model is not trusted on that.
 */
export async function suggestTerms({
  provider,
  purpose,
  existingTerms,
  rejectedTerms,
  documents,
}: SuggestTermsArgs): Promise<TermCandidate[]> {
  const model = languageModel(provider, "analysis");
  const header = `Purpose of the analysis:
${purpose.trim() || "(not provided; infer the likely subject from the current terms and the documents)"}

Current terms:
${bulletList(existingTerms)}

Rejected terms (do not propose again):
${bulletList(rejectedTerms)}`;

  const batches = batchDocuments(documents);
  const results = await mapLimit(batches, 3, async (batch) => {
    const body = batch
      .map((document) => `<document title=${JSON.stringify(document.title)}>\n${document.text}\n</document>`)
      .join("\n\n");
    const { output } = await generateText({
      model,
      instructions: INSTRUCTIONS,
      output: Output.object({ schema }),
      maxRetries: 3,
      prompt: `${header}\n\nDocuments:\n\n${body}`,
    });
    return output.suggestions;
  });

  const merged = new Map<string, TermCandidate>();
  for (const suggestions of results) {
    const seenInBatch = new Set<string>();
    for (const suggestion of suggestions) {
      const term = suggestion.term.trim().split(/\s+/).join(" ");
      const key = normalizeTerm(term);
      if (!key || seenInBatch.has(key)) continue;
      seenInBatch.add(key);
      const existing = merged.get(key);
      if (existing) existing.votes += 1;
      else merged.set(key, { term, reason: suggestion.reason.trim(), votes: 1 });
    }
  }
  return [...merged.values()];
}

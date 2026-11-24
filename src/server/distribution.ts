import { inArray } from "drizzle-orm";
import { getDb, schema } from "../db";
import { csvWithNote, distributionDownloadNote } from "../lib/text/explanations";
import {
  DISTRIBUTION_GROUPS,
  buildToneDistribution,
  distributionCsv,
  type DistributionGroup,
  type ToneDistribution,
} from "../lib/text/distribution";
import { findOccurrences, spanKey } from "../lib/text/match";
import { getDocumentRows } from "./documents";
import { listCategories, listEquivalences } from "./taxonomy";
import { listTerms, termPatterns } from "./terms";
import { listTones } from "./tones";

export function parseDistributionGroup(value: string | null): DistributionGroup {
  if (value && (DISTRIBUTION_GROUPS as string[]).includes(value)) return value as DistributionGroup;
  return "term";
}

export async function getToneDistribution(
  group: DistributionGroup,
  documentIds?: number[],
): Promise<ToneDistribution> {
  const documents = await getDocumentRows(documentIds);
  const terms = await listTerms();
  const patterns = await termPatterns();
  const tones = await listTones();
  const fallback = tones.find((tone) => tone.isDefault) ?? tones[0];
  const db = await getDb();
  const annotations =
    documents.length === 0
      ? []
      : await db
          .select()
          .from(schema.annotations)
          .where(
            inArray(
              schema.annotations.documentId,
              documents.map((document) => document.id),
            ),
          );
  const tagged = new Map(
    annotations.map((annotation) => [`${annotation.documentId}:${spanKey(annotation)}`, annotation]),
  );
  const occurrences = [];
  for (const document of documents) {
    for (const occurrence of findOccurrences(document.text, patterns)) {
      const annotation = tagged.get(`${document.id}:${spanKey(occurrence)}`);
      const toneId = annotation?.toneId ?? fallback?.id;
      if (toneId === undefined) continue;
      occurrences.push({ documentId: document.id, termId: occurrence.termId, toneId });
    }
  }
  const memberships = await db.select().from(schema.termCategoryMembers);
  return buildToneDistribution({
    group,
    tones,
    occurrences,
    terms,
    equivalences: await listEquivalences(),
    categories: await listCategories(),
    memberships,
    documents: documents.map((document) => ({ id: document.id, title: document.title })),
    documentIds,
  });
}

export async function toneDistributionCsv(
  group: DistributionGroup,
  documentIds?: number[],
): Promise<string> {
  const distribution = await getToneDistribution(group, documentIds);
  return csvWithNote(distributionCsv(distribution), distributionDownloadNote(group));
}

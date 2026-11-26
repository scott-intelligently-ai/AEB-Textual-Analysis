import type { DistributionGroup } from "./distribution";
import { toCsv } from "./csv";

/** A variant is always the same term. An equivalent stays a separate term. */
export const VARIANT_MEANING =
  "A variant is another spelling or a plural of the same term, such as wars for war. A variant is always found, highlighted, and counted as that term.";

export const EQUIVALENCE_MEANING =
  "An equivalent is a separate term with a similar meaning, such as conflict beside war. Equivalent terms stay separate for highlighting, tone tags, and frequency. They are counted together only in the tone distribution when it is set to Equivalent terms.";

export const CATEGORY_COLUMN_MEANING =
  "The categories column lists every category assigned to that term. A subcategory is written as its parent and its own name, and several categories are separated by a semicolon.";

export const FREQUENCY_DOWNLOAD_NOTE = `${VARIANT_MEANING} ${EQUIVALENCE_MEANING} This file counts each term on its own, including its variants. ${CATEGORY_COLUMN_MEANING}`;

export const JEV_DOWNLOAD_MEANING =
  "A tone suggested by Jev is counted as that tone even when it has not been confirmed. An occurrence with no tone of its own uses the default tone.";

export const OCCURRENCE_DOWNLOAD_NOTE = `${VARIANT_MEANING} The term column names that term, and matched_text is the spelling found in the document. ${CATEGORY_COLUMN_MEANING} ${EQUIVALENCE_MEANING} This file does not combine equivalent terms. ${JEV_DOWNLOAD_MEANING} tone_set_by is user for a tone you set or Jev suggested, and default when the occurrence has no tone of its own.`;

export const TONE_FREQUENCY_DOWNLOAD_NOTE = `${VARIANT_MEANING} ${EQUIVALENCE_MEANING} Each row is one term in one document. There is one count for each tone, then a total. ${JEV_DOWNLOAD_MEANING} ${CATEGORY_COLUMN_MEANING} This file does not combine equivalent terms.`;

export function distributionDownloadNote(group: DistributionGroup): string {
  const base = `${VARIANT_MEANING} Every occurrence counts. ${JEV_DOWNLOAD_MEANING}`;
  switch (group) {
    case "term":
      return `${base} Each row is one term. ${CATEGORY_COLUMN_MEANING} ${EQUIVALENCE_MEANING} This file does not combine equivalent terms.`;
    case "equivalence":
      return `${base} ${EQUIVALENCE_MEANING} Each row is one equivalence group, or a term that is not in a group. ${CATEGORY_COLUMN_MEANING} For an equivalence group, the categories are those of the terms in the group.`;
    case "category":
      return `${base} Each row is a category and includes terms assigned to it or to any of its subcategories. A term in more than one category is counted in each, so these totals can add up to more than the overall total. Equivalent terms are not combined in this file.`;
    case "subcategory":
      return `${base} Each row is a subcategory and includes only terms assigned directly to it. Equivalent terms are not combined in this file.`;
    case "document":
      return `${base} Each row is one document. Equivalent terms are not combined in this file.`;
    case "overall":
      return `${base} This is one total across the chosen documents. Equivalent terms are not combined in this file.`;
  }
}

/** Puts a reading note in the first row so a downloaded spreadsheet carries the same explanation as the page. */
export function csvWithNote(rows: (string | number)[][], note: string): string {
  return toCsv([["how_to_read_this_file", note], ...rows]);
}

export const TERM_IMPORT_TEMPLATE = toCsv([
  [
    "note",
    "One term per row. Separate items in a cell with /, with or without spaces around it. In terms, the first item is the term and the rest are variants, which are always counted as that term. A parenthetical ending such as (s) or (es) stands for both the singular and the plural, so shoe(s) is shoe and shoes; countr(y/ies) is country and countries. Categories lists every category for that term. Equivalents lists separate terms with a similar meaning; they stay separate and can be counted together. Leave a cell blank when it does not apply.",
  ],
  ["terms", "categories", "equivalents"],
  ["war(s)", "foreign policy", "conflict(s)"],
  ["peace", "foreign policy / diplomacy", "armistice"],
  ["tax(es) / tariff(s)", "economy", "duty"],
  ["freedom", "rights", ""],
]);

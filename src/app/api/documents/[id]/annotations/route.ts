import { z } from "zod";
import {
  confirmSuggestions,
  discardSuggestions,
  listAnnotations,
  setTone,
} from "@/server/annotations";
import { parseBody, parseId, route } from "@/server/http";

type Params = { id: string };

const put = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  /** Null clears the tag, returning the occurrence to the default tone. */
  toneId: z.number().int().positive().nullable(),
});

const post = z.object({ action: z.enum(["confirm", "discard"]) });

export const GET = route<Params>((_request, { id }) => listAnnotations(parseId(id, "Document")));

export const PUT = route<Params>(async (request, { id }) => {
  const { start, end, toneId } = await parseBody(request, put);
  setTone(parseId(id, "Document"), { start, end }, toneId);
});

/** Bulk actions on the document's unconfirmed AI suggestions. */
export const POST = route<Params>(async (request, { id }) => {
  const { action } = await parseBody(request, post);
  const documentId = parseId(id, "Document");
  return action === "confirm" ? confirmSuggestions(documentId) : discardSuggestions(documentId);
});

import { z } from "zod";
import { suggestDocumentTones } from "@/server/annotations";
import { parseBody, parseId, route } from "@/server/http";

/** With a span, one occurrence is judged; without, the whole document. */
const body = z.object({
  start: z.number().int().nonnegative().optional(),
  end: z.number().int().positive().optional(),
});

export const POST = route<{ id: string }>(async (request, { id }) => {
  const { start, end } = await parseBody(request, body);
  const span = start !== undefined && end !== undefined ? { start, end } : undefined;
  return suggestDocumentTones(parseId(id, "Document"), span);
});

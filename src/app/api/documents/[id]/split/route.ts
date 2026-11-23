import { z } from "zod";
import { splitDocument } from "@/server/documents";
import { parseBody, parseId, route } from "@/server/http";

const body = z.object({
  offset: z.number().int(),
  firstTitle: z.string().optional(),
  secondTitle: z.string().optional(),
});

export const POST = route<{ id: string }>(async (request, { id }) => {
  const { offset, firstTitle, secondTitle } = await parseBody(request, body);
  return splitDocument(parseId(id, "Document"), offset, {
    first: firstTitle,
    second: secondTitle,
  });
});

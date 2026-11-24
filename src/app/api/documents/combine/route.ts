import { z } from "zod";
import { combineDocuments } from "@/server/documents";
import { parseBody, route } from "@/server/http";

const body = z.object({
  /** Document ids in the order their text should appear. */
  ids: z.array(z.number().int().positive()),
  title: z.string().optional(),
});

export const POST = route(async (request) => {
  const { ids, title } = await parseBody(request, body);
  return combineDocuments(ids, title);
});

import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { generateSuggestions, listSuggestions } from "@/server/suggestions";

const body = z.object({
  /** Documents to read; all documents when omitted. */
  documentIds: z.array(z.number().int().positive()).optional(),
});

export const GET = route(() => listSuggestions());

export const POST = route(async (request) => {
  const { documentIds } = await parseBody(request, body);
  return generateSuggestions(documentIds);
});

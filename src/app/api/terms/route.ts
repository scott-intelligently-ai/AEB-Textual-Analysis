import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { createTerm, listTerms } from "@/server/terms";

const body = z.object({
  text: z.string(),
  variants: z.array(z.string()).optional(),
  caseSensitive: z.boolean().optional(),
});

export const GET = route(() => listTerms());

export const POST = route(async (request) => createTerm(await parseBody(request, body)));

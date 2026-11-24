import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { importTerms } from "@/server/terms";

const body = z.object({
  terms: z.array(
    z.object({
      text: z.string(),
      variants: z.array(z.string()).optional(),
      equivalence: z.string().nullable().optional(),
    }),
  ),
});

export const POST = route(async (request) => {
  const { terms } = await parseBody(request, body);
  return importTerms(terms);
});

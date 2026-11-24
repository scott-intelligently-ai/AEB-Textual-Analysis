import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { createEquivalence, listEquivalences } from "@/server/taxonomy";

const body = z.object({ name: z.string(), termIds: z.array(z.number().int().positive()).default([]) });

export const GET = route(() => listEquivalences());

export const POST = route(async (request) => {
  const { name, termIds } = await parseBody(request, body);
  return createEquivalence(name, termIds);
});

import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { createTone, listTonesWithUsage, reorderTones, TONE_DEFINITION_MAX } from "@/server/tones";

const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Choose a colour.");

const create = z.object({
  name: z.string(),
  color,
  score: z.number().finite().optional(),
  definition: z
    .string()
    .max(TONE_DEFINITION_MAX, `A tone definition can be at most ${TONE_DEFINITION_MAX} characters.`)
    .optional(),
});

const reorder = z.object({ ids: z.array(z.number().int().positive()) });

export const GET = route(() => listTonesWithUsage());

export const POST = route(async (request) => createTone(await parseBody(request, create)));

/** Replaces the display order with the given list of tone ids. */
export const PUT = route(async (request) => {
  const { ids } = await parseBody(request, reorder);
  return reorderTones(ids);
});

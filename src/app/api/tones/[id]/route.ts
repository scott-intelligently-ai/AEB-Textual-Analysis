import { z } from "zod";
import { parseBody, parseId, route } from "@/server/http";
import { deleteTone, updateTone } from "@/server/tones";

type Params = { id: string };

const body = z.object({
  name: z.string().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Choose a colour.")
    .optional(),
  score: z.number().finite().optional(),
  isDefault: z.boolean().optional(),
});

export const PATCH = route<Params>(async (request, { id }) =>
  updateTone(parseId(id, "Tone"), await parseBody(request, body)),
);

export const DELETE = route<Params>((_request, { id }) => deleteTone(parseId(id, "Tone")));

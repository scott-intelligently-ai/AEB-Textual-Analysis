import { z } from "zod";
import { parseBody, parseId, route } from "@/server/http";
import { deleteEquivalence, updateEquivalence } from "@/server/taxonomy";

type Params = { id: string };

const body = z.object({
  name: z.string().optional(),
  termIds: z.array(z.number().int().positive()).optional(),
});

export const PATCH = route<Params>(async (request, { id }) =>
  updateEquivalence(parseId(id, "Equivalence group"), await parseBody(request, body)),
);

export const DELETE = route<Params>((_request, { id }) =>
  deleteEquivalence(parseId(id, "Equivalence group")),
);

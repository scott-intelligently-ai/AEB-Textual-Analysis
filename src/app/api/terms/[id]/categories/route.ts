import { z } from "zod";
import { parseBody, parseId, route } from "@/server/http";
import { setTermCategories } from "@/server/taxonomy";

type Params = { id: string };

const body = z.object({ categoryIds: z.array(z.number().int().positive()) });

export const PUT = route<Params>(async (request, { id }) =>
  setTermCategories(parseId(id, "Term"), (await parseBody(request, body)).categoryIds),
);

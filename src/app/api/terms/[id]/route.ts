import { z } from "zod";
import { parseBody, parseId, route } from "@/server/http";
import { deleteTerm, updateTerm } from "@/server/terms";

type Params = { id: string };

const body = z.object({
  text: z.string(),
  variants: z.array(z.string()).optional(),
  caseSensitive: z.boolean().optional(),
});

export const PATCH = route<Params>(async (request, { id }) =>
  updateTerm(parseId(id, "Term"), await parseBody(request, body)),
);

export const DELETE = route<Params>((_request, { id }) => deleteTerm(parseId(id, "Term")));

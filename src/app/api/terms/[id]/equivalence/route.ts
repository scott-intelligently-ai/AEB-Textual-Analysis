import { z } from "zod";
import { parseBody, parseId, route } from "@/server/http";
import { setTermEquivalence } from "@/server/taxonomy";

type Params = { id: string };

const body = z.object({ equivalenceId: z.number().int().positive().nullable() });

export const PUT = route<Params>(async (request, { id }) => {
  const { equivalenceId } = await parseBody(request, body);
  await setTermEquivalence(parseId(id, "Term"), equivalenceId);
  return { equivalenceId };
});

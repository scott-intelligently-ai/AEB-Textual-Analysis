import { z } from "zod";
import { parseBody, parseId, route } from "@/server/http";
import { setDocumentTags } from "@/server/taxonomy";

type Params = { id: string };

const body = z.object({ tagIds: z.array(z.number().int().positive()) });

export const PUT = route<Params>(async (request, { id }) =>
  setDocumentTags(parseId(id, "Document"), (await parseBody(request, body)).tagIds),
);

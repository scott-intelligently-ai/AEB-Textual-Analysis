import { z } from "zod";
import { parseBody, parseId, route } from "@/server/http";
import { deleteDocumentTag, renameDocumentTag } from "@/server/taxonomy";

type Params = { id: string };

const body = z.object({ name: z.string() });

export const PATCH = route<Params>(async (request, { id }) =>
  renameDocumentTag(parseId(id, "Tag"), (await parseBody(request, body)).name),
);

export const DELETE = route<Params>((_request, { id }) => deleteDocumentTag(parseId(id, "Tag")));

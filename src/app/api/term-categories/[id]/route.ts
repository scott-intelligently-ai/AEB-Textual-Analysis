import { z } from "zod";
import { parseBody, parseId, route } from "@/server/http";
import { deleteCategory, renameCategory } from "@/server/taxonomy";

type Params = { id: string };

const body = z.object({ name: z.string() });

export const PATCH = route<Params>(async (request, { id }) =>
  renameCategory(parseId(id, "Category"), (await parseBody(request, body)).name),
);

export const DELETE = route<Params>((_request, { id }) => deleteCategory(parseId(id, "Category")));

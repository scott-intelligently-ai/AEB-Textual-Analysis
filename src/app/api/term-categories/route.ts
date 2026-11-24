import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { createCategory, listCategories } from "@/server/taxonomy";

const body = z.object({ name: z.string(), parentId: z.number().int().positive().nullable().optional() });

export const GET = route(() => listCategories());

export const POST = route(async (request) => {
  const { name, parentId } = await parseBody(request, body);
  return createCategory(name, parentId);
});

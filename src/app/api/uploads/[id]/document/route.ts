import { z } from "zod";
import { createDocumentFromUpload } from "@/server/documents";
import { parseBody, parseId, route } from "@/server/http";

const body = z.object({ title: z.string().optional() });

export const POST = route<{ id: string }>(async (request, { id }) => {
  const { title } = await parseBody(request, body);
  return createDocumentFromUpload(parseId(id, "Upload"), title);
});

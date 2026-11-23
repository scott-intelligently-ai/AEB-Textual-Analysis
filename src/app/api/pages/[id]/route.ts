import { z } from "zod";
import { parseBody, parseId, route } from "@/server/http";
import { updatePageText } from "@/server/uploads";

const body = z.object({ text: z.string() });

export const PATCH = route<{ id: string }>(async (request, { id }) => {
  const { text } = await parseBody(request, body);
  updatePageText(parseId(id, "Page"), text);
});

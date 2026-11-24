import { z } from "zod";
import { parseBody, parseId, route } from "@/server/http";
import { decideSuggestion } from "@/server/suggestions";

const body = z.object({ status: z.enum(["pending", "accepted", "rejected"]) });

export const PATCH = route<{ id: string }>(async (request, { id }) => {
  const { status } = await parseBody(request, body);
  await decideSuggestion(parseId(id, "Suggestion"), status);
});

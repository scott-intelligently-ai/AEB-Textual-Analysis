import { z } from "zod";
import { PROVIDERS } from "@/lib/ai/providers";
import { parseBody, parseId, route } from "@/server/http";
import { getSettings } from "@/server/settings";
import { enqueueOcr, getPage } from "@/server/uploads";

const body = z.object({ provider: z.enum(PROVIDERS).optional() });

export const POST = route<{ id: string }>(async (request, { id }) => {
  const { provider } = await parseBody(request, body);
  const page = getPage(parseId(id, "Page"));
  enqueueOcr([page.id], provider ?? getSettings().ocrProvider);
});

import { z } from "zod";
import { PROVIDERS } from "@/lib/ai/providers";
import { parseBody, parseId, route } from "@/server/http";
import { getSettings } from "@/server/settings";
import { enqueueOcr, getUpload } from "@/server/uploads";

const body = z.object({
  provider: z.enum(PROVIDERS).optional(),
  /** Limit the run to pages whose conversion failed. */
  failedOnly: z.boolean().optional(),
});

export const POST = route<{ id: string }>(async (request, { id }) => {
  const { provider, failedOnly } = await parseBody(request, body);
  const upload = getUpload(parseId(id, "Upload"));
  const pages = upload.pages.filter(
    (page) =>
      page.ocrStatus !== "pending" &&
      page.ocrStatus !== "processing" &&
      (!failedOnly || page.ocrStatus === "error"),
  );
  enqueueOcr(
    pages.map((page) => page.id),
    provider ?? getSettings().ocrProvider,
  );
  return { queued: pages.length };
});

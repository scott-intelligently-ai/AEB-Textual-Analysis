import { z } from "zod";
import { PROVIDERS } from "@/lib/ai/providers";
import { parseBody, route } from "@/server/http";
import { settingsResponse, updateSettings } from "@/server/settings";

const body = z.object({
  analysisPurpose: z.string().max(4000).optional(),
  ocrProvider: z.enum(PROVIDERS).optional(),
  analysisProvider: z.enum(PROVIDERS).optional(),
});

export const GET = route(() => settingsResponse());

export const PUT = route(async (request) => {
  await updateSettings(await parseBody(request, body));
  return settingsResponse();
});

import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { listUploads, prepareUpload } from "@/server/uploads";

const body = z.object({
  filename: z.string(),
  mimeType: z.string(),
  size: z.number().positive(),
});

export const GET = route(() => listUploads());

/**
 * Reserves a scan and returns a token the browser uses to upload the file
 * straight to storage. The file itself never passes through this server.
 */
export const POST = route(async (request) => prepareUpload(await parseBody(request, body)));

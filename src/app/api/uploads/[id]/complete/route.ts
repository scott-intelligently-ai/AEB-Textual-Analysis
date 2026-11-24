import { parseId, route } from "@/server/http";
import { queueUpload } from "@/server/uploads";

/** Called after the browser has finished uploading the file to storage. */
export const POST = route<{ id: string }>(async (_request, { id }) => queueUpload(parseId(id, "Upload")));

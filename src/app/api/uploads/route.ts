import { badRequest, route } from "@/server/http";
import { createUpload, listUploads, type UploadSummary } from "@/server/uploads";

export const GET = route(() => listUploads());

export const POST = route(async (request) => {
  const form = await request.formData();
  const files = form.getAll("files").filter((entry): entry is File => entry instanceof File);
  if (files.length === 0) throw badRequest("Choose at least one file to upload.");

  const uploads: UploadSummary[] = [];
  const failures: { filename: string; error: string }[] = [];
  for (const file of files) {
    try {
      uploads.push(await createUpload(file));
    } catch (error) {
      failures.push({
        filename: file.name,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return { uploads, failures };
});

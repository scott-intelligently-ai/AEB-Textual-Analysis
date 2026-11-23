import fs from "node:fs";
import { notFound, parseId, route } from "@/server/http";
import { getPage } from "@/server/uploads";

export const GET = route<{ id: string }>(async (_request, { id }) => {
  const page = getPage(parseId(id, "Page"));
  let image: Buffer;
  try {
    image = await fs.promises.readFile(page.imagePath);
  } catch {
    throw notFound("Page image");
  }
  return new Response(new Uint8Array(image), {
    headers: {
      "Content-Type": "image/jpeg",
      // A page image never changes once it has been rendered.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
});

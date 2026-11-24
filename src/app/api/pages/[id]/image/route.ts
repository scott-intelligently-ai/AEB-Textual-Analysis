import { notFound, parseId, route } from "@/server/http";
import { getObject } from "@/server/storage";
import { getPage } from "@/server/uploads";

export const GET = route<{ id: string }>(async (_request, { id }) => {
  const page = await getPage(parseId(id, "Page"));
  if (!page.storagePath) throw notFound("Page image");
  let image: Buffer;
  try {
    image = await getObject(page.storagePath);
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

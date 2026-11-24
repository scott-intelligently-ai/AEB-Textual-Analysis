import sharp from "sharp";

/** Longest edge of a stored page image; plenty for typed text and within model limits. */
const MAX_EDGE = 2000;
const PDF_SCALE = 3;

async function toPageJpeg(input: Buffer, page = 0): Promise<Buffer> {
  return sharp(input, { page })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
}

/** Renders a PDF or image into one JPEG per page. */
export async function renderPages(buffer: Buffer, extension: string): Promise<Buffer[]> {
  if (extension === ".pdf") {
    const { pdf } = await import("pdf-to-img");
    const document = await pdf(buffer, { scale: PDF_SCALE });
    try {
      const pages: Buffer[] = [];
      for await (const image of document) pages.push(await toPageJpeg(image));
      return pages;
    } finally {
      await document.destroy();
    }
  }
  const { pages = 1 } = await sharp(buffer).metadata();
  const frames = extension === ".gif" ? 1 : pages;
  const images: Buffer[] = [];
  for (let page = 0; page < frames; page += 1) images.push(await toPageJpeg(buffer, page));
  return images;
}

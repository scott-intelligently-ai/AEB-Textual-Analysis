/**
 * File types the upload area accepts.
 * Scans are rendered to page images and transcribed. Word, RTF, and plain text
 * already contain text, so they are read directly and never sent for OCR.
 */

export const IMAGE_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".tif",
  ".tiff",
  ".avif",
] as const;

export const TEXT_EXTENSIONS = [".doc", ".docx", ".rtf", ".txt"] as const;

export const UPLOAD_ACCEPT = [".pdf", ...IMAGE_EXTENSIONS, ...TEXT_EXTENSIONS].join(",");

export function extensionOfFilename(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const dot = base.trim().lastIndexOf(".");
  if (dot <= 0) return "";
  return base.trim().slice(dot).toLowerCase();
}

export function isTextExtension(extension: string): boolean {
  return (TEXT_EXTENSIONS as readonly string[]).includes(extension);
}

export function isSupportedUploadExtension(extension: string): boolean {
  return (
    extension === ".pdf" ||
    (IMAGE_EXTENSIONS as readonly string[]).includes(extension) ||
    isTextExtension(extension)
  );
}

/** A text upload has no page image. Before pages exist, the filename decides. */
export function isDirectTextUpload(upload: {
  filename: string;
  pages: { hasImage: boolean }[];
}): boolean {
  if (upload.pages.length > 0) return upload.pages.every((page) => !page.hasImage);
  return isTextExtension(extensionOfFilename(upload.filename));
}

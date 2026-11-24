import { z } from "zod";
import {
  deleteDocument,
  getDocument,
  renameDocument,
  updateDocumentText,
} from "@/server/documents";
import { parseBody, parseId, route } from "@/server/http";

type Params = { id: string };

const patch = z.object({ title: z.string().optional(), text: z.string().optional() });

export const GET = route<Params>((_request, { id }) => getDocument(parseId(id, "Document")));

export const PATCH = route<Params>(async (request, { id }) => {
  const documentId = parseId(id, "Document");
  const { title, text } = await parseBody(request, patch);
  if (title !== undefined) await renameDocument(documentId, title);
  return text === undefined ? { cleared: 0 } : updateDocumentText(documentId, text);
});

export const DELETE = route<Params>((_request, { id }) => deleteDocument(parseId(id, "Document")));

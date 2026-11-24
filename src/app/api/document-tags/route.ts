import { z } from "zod";
import { parseBody, route } from "@/server/http";
import { createDocumentTag, listDocumentTags } from "@/server/taxonomy";

const body = z.object({ name: z.string() });

export const GET = route(() => listDocumentTags());

export const POST = route(async (request) => createDocumentTag((await parseBody(request, body)).name));

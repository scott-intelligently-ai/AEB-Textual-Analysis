import { parseId, route } from "@/server/http";
import { deleteUpload, getUpload } from "@/server/uploads";

type Params = { id: string };

export const GET = route<Params>((_request, { id }) => getUpload(parseId(id, "Upload")));

export const DELETE = route<Params>((_request, { id }) => deleteUpload(parseId(id, "Upload")));

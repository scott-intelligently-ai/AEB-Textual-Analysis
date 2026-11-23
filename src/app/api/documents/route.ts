import { listDocuments } from "@/server/documents";
import { route } from "@/server/http";

export const GET = route(() => listDocuments());

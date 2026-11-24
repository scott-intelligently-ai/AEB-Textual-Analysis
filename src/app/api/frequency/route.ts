import { getFrequency } from "@/server/frequency";
import { parseIdList, route } from "@/server/http";

/** Counts for all documents, or only those listed in `?ids=1,2,3`. */
export const GET = route((request) => getFrequency(parseIdList(request.nextUrl.searchParams.get("ids"))));

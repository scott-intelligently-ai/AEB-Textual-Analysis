import { suggestAllDocumentTones } from "@/server/annotations";
import { route } from "@/server/http";

/** Asks Jev for tones in every document. */
export const POST = route(() => suggestAllDocumentTones());

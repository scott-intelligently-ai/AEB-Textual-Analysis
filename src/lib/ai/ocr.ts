import { generateText } from "ai";
import {
  ILLEGIBLE_MARK,
  UNSURE_MARK,
  cleanTranscription,
} from "../text/transcription";
import { languageModel, modelId, type Provider } from "./models";

const INSTRUCTIONS = `You transcribe scanned pages of documents, usually the text of speeches, so that the words can be counted and analysed. Accuracy matters more than anything else: a misread word silently changes the analysis.

Rules:
- Transcribe the text exactly as printed. Keep the original spelling, capitalisation, and punctuation, including any mistakes. Do not correct, modernise, translate, summarise, or complete anything.
- Put each paragraph on a single line. When a word is broken across two lines with a hyphen, join it back into one word; keep hyphens that belong to the word itself.
- Separate paragraphs with one blank line, and keep each heading on its own line.
- Leave out page numbers, running headers and footers, stamps, and handwritten marks that are not part of the text.
- Where a word cannot be read at all, write ${ILLEGIBLE_MARK} in its place. Where you can read a word but are not sure of it, give your best reading followed immediately by ${UNSURE_MARK}. Never guess silently.
- Reply with the transcription only: no commentary, no description of the page, and no Markdown. If the page contains no text, reply with nothing.`;

export interface Transcription {
  text: string;
  model: string;
}

/** Transcribes one page image (JPEG) with the chosen provider's vision model. */
export async function transcribePage(
  image: Buffer,
  provider: Provider,
): Promise<Transcription> {
  const { text, finishReason } = await generateText({
    model: languageModel(provider, "ocr"),
    instructions: INSTRUCTIONS,
    maxOutputTokens: 16000,
    maxRetries: 3,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "Transcribe this page." },
          {
            type: "file",
            mediaType: "image/jpeg",
            data: image,
            providerOptions: { openai: { imageDetail: "high" } },
          },
        ],
      },
    ],
  });
  if (finishReason === "length") {
    throw new Error(
      "The transcription was cut off because the page holds more text than one response allows.",
    );
  }
  return { text: cleanTranscription(text), model: modelId(provider, "ocr") };
}

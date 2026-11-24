import mammoth from "mammoth";
import WordExtractor from "word-extractor";
import { isTextExtension } from "./fileKinds";
import { cleanTranscription } from "./transcription";

/**
 * Turns the text read from a Word, RTF, or plain-text file into the same
 * normalised text the rest of the app stores for a document.
 */
export function toUsageText(text: string): string {
  return cleanTranscription(
    text
      .replace(/\u0000/g, "")
      .replace(/\u00ad/g, "")
      .replace(/[\u2028\u2029]/g, "\n")
      .replace(/\u00a0/g, " ")
      .replace(/\u000b/g, "\n")
      .replace(/\f/g, "\n\n")
      .replace(/[^\S\n]+/g, " "),
  );
}

const ANSI_CODE_PAGES: Record<number, string> = {
  1250: "windows-1250",
  1251: "windows-1251",
  1252: "windows-1252",
  1253: "windows-1253",
  1254: "windows-1254",
  1255: "windows-1255",
  1256: "windows-1256",
  1257: "windows-1257",
  1258: "windows-1258",
};

/** Groups whose contents are formatting or metadata rather than the speech. */
const SKIP_DESTINATIONS = new Set([
  "fonttbl",
  "colortbl",
  "stylesheet",
  "info",
  "pict",
  "object",
  "footer",
  "footerf",
  "footerl",
  "footerr",
  "header",
  "headerf",
  "headerl",
  "headerr",
  "footnote",
  "annotation",
  "fldinst",
  "xe",
  "tc",
  "listtable",
  "listoverridetable",
  "revtbl",
  "rsidtbl",
  "generator",
  "latentstyles",
  "colorschememapping",
  "themedata",
  "datastore",
  "xmlnstbl",
  "filetbl",
  "nonshppict",
  "shppict",
  "background",
  "atnid",
  "atnauthor",
  "datafield",
  "wgrffmtfilter",
  "xmlopen",
  "factoidname",
  "mmathpr",
]);

const SYMBOLS: Record<string, string> = {
  emdash: "\u2014",
  endash: "\u2013",
  lquote: "\u2018",
  rquote: "\u2019",
  ldblquote: "\u201c",
  rdblquote: "\u201d",
  bullet: "\u2022",
  tab: "\t",
  emspace: " ",
  enspace: " ",
  qmspace: " ",
};

function looksLikeZip(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

function looksLikeOle(buffer: Buffer): boolean {
  return (
    buffer.length >= 8 &&
    buffer[0] === 0xd0 &&
    buffer[1] === 0xcf &&
    buffer[2] === 0x11 &&
    buffer[3] === 0xe0
  );
}

function rtfSource(buffer: Buffer): string {
  let start = 0;
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    start = 3;
  }
  return buffer.subarray(start).toString("latin1").trimStart();
}

function looksLikeRtf(buffer: Buffer): boolean {
  return rtfSource(buffer).startsWith("{\\rtf");
}

/** Decodes a plain-text upload, including the encodings Word uses for "Unicode text". */
export function decodePlainText(buffer: Buffer): string {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return buffer.subarray(2).toString("utf16le");
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.alloc(buffer.length - (buffer.length % 2 === 0 ? 2 : 3));
    for (let i = 2; i + 1 < buffer.length; i += 2) {
      swapped[i - 2] = buffer[i + 1];
      swapped[i - 1] = buffer[i];
    }
    return swapped.toString("utf16le");
  }
  let start = 0;
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    start = 3;
  }
  const body = buffer.subarray(start);
  if (utf16LeWithoutBom(body)) return body.toString("utf16le");
  const utf8 = body.toString("utf8");
  if (utf8.includes("\u0000")) throw new Error("This file is not plain text.");
  if (utf8.includes("\uFFFD")) return new TextDecoder("windows-1252").decode(body);
  return utf8;
}

function utf16LeWithoutBom(buffer: Buffer): boolean {
  if (buffer.length < 8 || buffer.length % 2 !== 0) return false;
  const samples = Math.min(buffer.length, 256);
  let highNulls = 0;
  let checked = 0;
  for (let i = 1; i < samples; i += 2) {
    checked += 1;
    if (buffer[i] === 0) highNulls += 1;
  }
  return checked > 0 && highNulls / checked > 0.8;
}

/**
 * Reads the visible text out of an RTF document. Formatting, fonts, and
 * embedded images are dropped; paragraph breaks are kept.
 */
export function rtfToText(source: string): string {
  if (!source.startsWith("{\\rtf")) throw new Error("This RTF file could not be read.");
  const out: string[] = [];
  let i = 0;
  let uc = 1;
  const ucStack: number[] = [];
  let codepage = 1252;
  let depth = 0;
  const decoders = new Map<number, TextDecoder>();

  function decodeByte(byte: number): string {
    let decoder = decoders.get(codepage);
    if (!decoder) {
      const label = ANSI_CODE_PAGES[codepage] ?? "windows-1252";
      try {
        decoder = new TextDecoder(label);
      } catch {
        decoder = new TextDecoder("windows-1252");
      }
      decoders.set(codepage, decoder);
    }
    return decoder.decode(Uint8Array.of(byte));
  }

  function peekDestination(): { ignorable: boolean; word: string } | null {
    let j = i;
    while (j < source.length && (source[j] === "\r" || source[j] === "\n")) j += 1;
    if (source[j] !== "\\") return null;
    j += 1;
    let ignorable = false;
    if (source[j] === "*") {
      ignorable = true;
      j += 1;
      while (j < source.length && (source[j] === "\r" || source[j] === "\n")) j += 1;
      if (source[j] === "\\") j += 1;
    }
    if (!/[A-Za-z]/.test(source[j] ?? "")) return { ignorable, word: "" };
    let word = "";
    while (j < source.length && /[A-Za-z]/.test(source[j])) {
      word += source[j];
      j += 1;
    }
    return { ignorable, word: word.toLowerCase() };
  }

  /** Skips the ANSI stand-in that follows a `\u` character. `\'hh` counts as one. */
  function skipFallback(count: number): void {
    while (count > 0 && i < source.length) {
      const c = source[i];
      if (c === "\r" || c === "\n") {
        i += 1;
        continue;
      }
      if (c === "\\" && source[i + 1] === "'") {
        i += 4;
        count -= 1;
        continue;
      }
      if (c === "\\" || c === "{" || c === "}") return;
      i += 1;
      count -= 1;
    }
  }

  function readControl(skip: boolean): void {
    let word = "";
    while (i < source.length && /[A-Za-z]/.test(source[i])) {
      word += source[i];
      i += 1;
    }
    word = word.toLowerCase();
    let negative = false;
    if (source[i] === "-") {
      negative = true;
      i += 1;
    }
    let digits = "";
    while (i < source.length && /[0-9]/.test(source[i])) {
      digits += source[i];
      i += 1;
    }
    // The space after a control word is a delimiter, not text.
    if (source[i] === " ") i += 1;
    const value = digits.length > 0 ? (negative ? -Number(digits) : Number(digits)) : null;

    if (word === "bin" && value !== null && value > 0) {
      i += Math.min(value, Math.max(0, source.length - i));
      return;
    }
    if (word === "uc" && value !== null) {
      uc = value;
      return;
    }
    if (word === "ansicpg" && value !== null) {
      codepage = value;
      return;
    }
    if (word === "u" && value !== null) {
      const code = value < 0 ? value + 65536 : value;
      if (!skip && code > 0 && code <= 0x10ffff) out.push(String.fromCodePoint(code));
      skipFallback(uc);
      return;
    }
    if (skip) return;
    if (word === "par" || word === "line") {
      out.push("\n");
      return;
    }
    if (word === "page" || word === "sect" || word === "column") {
      out.push("\n\n");
      return;
    }
    if (word === "cell") {
      out.push("\t");
      return;
    }
    if (word === "row") {
      out.push("\n");
      return;
    }
    const symbol = SYMBOLS[word];
    if (symbol) out.push(symbol);
  }

  function parseGroup(skip: boolean): void {
    depth += 1;
    if (depth > 200) throw new Error("This RTF file could not be read.");
    ucStack.push(uc);
    const dest = peekDestination();
    const groupSkip =
      skip || dest?.ignorable === true || (dest?.word ? SKIP_DESTINATIONS.has(dest.word) : false);

    while (i < source.length) {
      const c = source[i];
      if (c === "{") {
        i += 1;
        parseGroup(groupSkip);
        continue;
      }
      if (c === "}") {
        i += 1;
        uc = ucStack.pop() ?? 1;
        depth -= 1;
        return;
      }
      if (c === "\\") {
        i += 1;
        const n = source[i];
        if (n === undefined) break;
        if (n === "\\" || n === "{" || n === "}") {
          if (!groupSkip) out.push(n);
          i += 1;
          continue;
        }
        if (n === "~") {
          if (!groupSkip) out.push("\u00a0");
          i += 1;
          continue;
        }
        if (n === "-") {
          i += 1;
          continue;
        }
        if (n === "_") {
          if (!groupSkip) out.push("-");
          i += 1;
          continue;
        }
        if (n === "*") {
          i += 1;
          if (source[i] === "\\") i += 1;
          if (/[A-Za-z]/.test(source[i] ?? "")) readControl(true);
          continue;
        }
        if (n === "'") {
          const hex = source.slice(i + 1, i + 3);
          i += 3;
          if (!groupSkip && /^[0-9a-fA-F]{2}$/.test(hex)) {
            out.push(decodeByte(Number.parseInt(hex, 16)));
          }
          continue;
        }
        if (n === "\n" || n === "\r") {
          i += 1;
          continue;
        }
        if (/[A-Za-z]/.test(n)) {
          readControl(groupSkip);
          continue;
        }
        i += 1;
        continue;
      }
      if (c === "\r" || c === "\n") {
        i += 1;
        continue;
      }
      if (!groupSkip) out.push(c);
      i += 1;
    }
    uc = ucStack.pop() ?? 1;
    depth -= 1;
  }

  if (source[0] !== "{") throw new Error("This RTF file could not be read.");
  i = 1;
  parseGroup(false);
  return out.join("");
}

function wordFailure(error: unknown): Error {
  const detail = error instanceof Error ? error.message.replace(/\s+/g, " ").trim() : "";
  if (!detail || detail.length > 160) return new Error("This Word file could not be read.");
  return new Error(`This Word file could not be read. ${detail}`);
}

async function readDoc(buffer: Buffer): Promise<string> {
  try {
    const document = await new WordExtractor().extract(buffer);
    return document.getBody({ filterUnicode: false });
  } catch (error) {
    throw wordFailure(error);
  }
}

async function readDocx(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    if (result.value.trim()) return result.value;
  } catch (error) {
    if (!looksLikeOle(buffer)) throw wordFailure(error);
  }
  return readDoc(buffer);
}

async function readByKind(buffer: Buffer, extension: string): Promise<string> {
  if (extension === ".txt") return decodePlainText(buffer);
  if (extension === ".rtf" || (extension === ".doc" && looksLikeRtf(buffer))) {
    return rtfToText(rtfSource(buffer));
  }
  if (extension === ".docx" || looksLikeZip(buffer)) return readDocx(buffer);
  if (extension === ".doc" || looksLikeOle(buffer)) return readDoc(buffer);
  throw new Error("This Word file could not be read.");
}

/** Reads a Word, RTF, or text file into the app's document text. Never calls OCR. */
export async function extractDocumentText(buffer: Buffer, extension: string): Promise<string> {
  const ext = extension.toLowerCase();
  if (!isTextExtension(ext)) throw new Error("This file is not a Word, RTF, or text file.");
  let raw: string;
  try {
    raw = await readByKind(buffer, ext);
  } catch (error) {
    if (error instanceof Error && /could not be read|not plain text/.test(error.message)) throw error;
    throw wordFailure(error);
  }
  const text = toUsageText(raw);
  if (!text) throw new Error("The file contains no text.");
  return text;
}

import { crc32 } from "node:zlib";
import { describe, expect, it } from "vitest";
import { prepareUpload } from "@/server/uploads";
import { extractDocumentText } from "./extract";
import { UPLOAD_ACCEPT, extensionOfFilename, isTextExtension } from "./fileKinds";

describe("upload file kinds", () => {
  it("accepts Word, RTF, and text alongside scans", () => {
    expect(extensionOfFilename("Speech.DOCX")).toBe(".docx");
    expect(extensionOfFilename("notes.txt")).toBe(".txt");
    expect(isTextExtension(".doc")).toBe(true);
    expect(isTextExtension(".pdf")).toBe(false);
    for (const extension of [".doc", ".docx", ".rtf", ".txt"]) {
      expect(UPLOAD_ACCEPT.split(",")).toContain(extension);
    }
  });

  it("refuses a file that is neither a scan nor readable text", async () => {
    await expect(
      prepareUpload({
        filename: "budget.xlsx",
        mimeType: "application/vnd.ms-excel",
        size: 20,
      }),
    ).rejects.toThrow(/Word document/);
  });
});

describe("plain text", () => {
  it("normalises line endings into the text the app stores", async () => {
    const text = await extractDocumentText(Buffer.from("Hello\r\n\r\nPeace.\n"), ".txt");
    expect(text).toBe("Hello\n\nPeace.");
  });

  it("reads a UTF-8 byte order mark and UTF-16 text", async () => {
    expect(await extractDocumentText(Buffer.from("\uFEFFpeace", "utf8"), ".txt")).toBe("peace");
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("peace", "utf16le")]);
    expect(await extractDocumentText(utf16, ".txt")).toBe("peace");
  });

  it("reads Windows-1252 punctuation as text", async () => {
    const buffer = Buffer.from([0x48, 0x65, 0x92, 0x73]);
    expect(await extractDocumentText(buffer, ".txt")).toBe("He\u2019s");
  });

  it("rejects a binary file given a text name", async () => {
    await expect(extractDocumentText(Buffer.from([0x00, 0x01, 0x02, 0x00, 0xff]), ".txt")).rejects.toThrow(
      /not plain text/,
    );
  });
});

describe("RTF", () => {
  it("keeps the speech and drops fonts, headers, and field codes", async () => {
    const rtf = String.raw`{\rtf1\ansi\ansicpg1252\deff0\uc1
{\fonttbl{\f0\froman Times New Roman;}}
{\*\generator Msftedit;}
{\header Page \chpgn }
\f0\fs24 Hello, world.\par
This is a speech about peace.\par
He said \u8216\'91hello\u8217\'92.\par
A dash\emdash  here.\par
{\field{\*\fldinst HYPERLINK "http://example.com"}{\fldrslt cited}}
}`;
    expect(await extractDocumentText(Buffer.from(rtf), ".rtf")).toBe(
      [
        "Hello, world.",
        "This is a speech about peace.",
        "He said \u2018hello\u2019.",
        "A dash\u2014 here.",
        "cited",
      ].join("\n"),
    );
  });

  it("reads an RTF file that was saved with a .doc name", async () => {
    const rtf = "{\\rtf1\\ansi peace\\par}";
    expect(await extractDocumentText(Buffer.from(rtf), ".doc")).toBe("peace");
  });
});

describe("Word", () => {
  it("reads a .docx into paragraphs of plain text", async () => {
    const xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Hello, world.</w:t></w:r></w:p>
    <w:p><w:r><w:t>This is a speech about peace.</w:t></w:r></w:p>
  </w:body>
</w:document>`;
    const docx = zipStored([
      {
        name: "[Content_Types].xml",
        data: Buffer.from(
          `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
        ),
      },
      { name: "word/document.xml", data: Buffer.from(xml) },
    ]);
    expect(await extractDocumentText(docx, ".docx")).toBe(
      "Hello, world.\n\nThis is a speech about peace.",
    );
    expect(await extractDocumentText(docx, ".doc")).toBe(
      "Hello, world.\n\nThis is a speech about peace.",
    );
  });

  it("explains when a Word file cannot be read", async () => {
    const header = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    await expect(extractDocumentText(header, ".doc")).rejects.toThrow(/could not be read/);
  });
});

function zipStored(files: { name: string; data: Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name);
    const crc = crc32(file.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(file.data.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    const chunk = Buffer.concat([local, name, file.data]);
    parts.push(chunk);
    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4);
    cen.writeUInt16LE(20, 6);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(file.data.length, 20);
    cen.writeUInt32LE(file.data.length, 24);
    cen.writeUInt16LE(name.length, 28);
    cen.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cen, name]));
    offset += chunk.length;
  }
  const centralDir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, centralDir, end]);
}

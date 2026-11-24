declare module "word-extractor" {
  interface WordExtractOptions {
    filterUnicode?: boolean;
  }

  interface WordDocument {
    getBody(options?: WordExtractOptions): string;
  }

  export default class WordExtractor {
    extract(source: Buffer | string): Promise<WordDocument>;
  }
}

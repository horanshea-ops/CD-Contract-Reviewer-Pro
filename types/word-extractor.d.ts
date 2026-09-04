declare module "word-extractor" {
  interface ExtractedDocument {
    getBody(): string;
    getFootnotes(): string;
    getHeaders(): string;
    getEndnotes(): string;
    getAnnotations(): string;
  }

  export default class WordExtractor {
    extract(input: Buffer | string): Promise<ExtractedDocument>;
  }
}

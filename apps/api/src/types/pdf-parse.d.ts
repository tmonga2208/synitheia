/**
 * pdf-parse ships no types. Only the two fields we actually read are declared —
 * a fuller hand-written definition would be a maintenance liability that drifts.
 */
declare module 'pdf-parse' {
  interface PdfParseResult {
    text: string;
    numpages: number;
  }

  function pdfParse(data: Buffer | Uint8Array): Promise<PdfParseResult>;

  export default pdfParse;
}

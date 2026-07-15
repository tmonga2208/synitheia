/**
 * pdf-parse ships no types. Only the two fields we actually read are declared —
 * a fuller hand-written definition would be a maintenance liability that drifts.
 */
declare module 'pdf-parse' {
  interface PdfParseResult {
    text: string;
    numpages: number;
  }

  /**
   * pdf-parse forwards this argument verbatim to pdf.js's `getDocument`, which takes
   * either a raw buffer or a source object. The source object is the only way to open a
   * password-protected statement — pdf-parse exposes no password option of its own.
   */
  type PdfSource =
    | Buffer
    | Uint8Array
    | { data: Buffer | Uint8Array; password?: string };

  function pdfParse(data: PdfSource): Promise<PdfParseResult>;

  export default pdfParse;
}

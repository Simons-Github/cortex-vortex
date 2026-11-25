/**
 * Client-safe PDF upload limits and checks. Used by the create-topic dialog
 * and study room before hitting Storage, and again on the server so a
 * crafted request cannot skip the file picker.
 */
export const TOPIC_PDF_BUCKET = "topic-pdfs";
export const TOPIC_PDF_MAX_BYTES = 5 * 1024 * 1024;
export const TOPIC_PDF_MAX_PAGES = 20;
export const TOPIC_PDF_MAX_BRIEF_CHARS = 24_000;
export const TOPIC_PDF_MAX_FILE_NAME = 200;

const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF

export function topicPdfObjectPath(userId: string, topicId: string): string {
  return `${userId}/${topicId}/source.pdf`;
}

export function isPdfMagicBytes(bytes: Uint8Array): boolean {
  if (bytes.length < PDF_MAGIC.length) return false;
  return PDF_MAGIC.every((b, i) => bytes[i] === b);
}

/**
 * Best-effort page count from PDF source tokens. Counts `/Type /Page` but
 * not `/Type /Pages`. Returns `null` when the file looks binary-compressed
 * enough that no page objects are visible in the sampled prefix.
 */
export function estimatePdfPageCount(bytes: Uint8Array): number | null {
  const sample = bytes.byteLength > 2_000_000 ? bytes.subarray(0, 2_000_000) : bytes;
  const text = new TextDecoder("latin1").decode(sample);
  const matches = text.match(/\/Type\s*\/Page(?!\s*s)/g);
  if (!matches?.length) return null;
  return matches.length;
}

export type PdfValidationError =
  "not-pdf" | "too-large" | "too-many-pages" | "empty" | "name-too-long";

export function validatePdfBytes(bytes: Uint8Array, fileName: string): PdfValidationError | null {
  const name = fileName.trim();
  if (!name || name.length > TOPIC_PDF_MAX_FILE_NAME) return "name-too-long";
  if (bytes.byteLength === 0) return "empty";
  if (bytes.byteLength > TOPIC_PDF_MAX_BYTES) return "too-large";
  if (!isPdfMagicBytes(bytes)) return "not-pdf";
  const pages = estimatePdfPageCount(bytes);
  if (pages !== null && pages > TOPIC_PDF_MAX_PAGES) return "too-many-pages";
  return null;
}

export function pdfValidationMessage(error: PdfValidationError): string {
  switch (error) {
    case "not-pdf":
      return "That file is not a PDF.";
    case "too-large":
      return "PDFs must be 5 MB or smaller.";
    case "too-many-pages":
      return "PDFs can have at most 20 pages.";
    case "empty":
      return "That PDF is empty.";
    case "name-too-long":
      return "The file name is too long.";
  }
}

import { ingestTopicPdf, type IngestTopicPdfResponse } from "@/lib/gemini-actions";
import { pdfValidationMessage, validatePdfBytes, type PdfValidationError } from "@/lib/pdf";
import { uploadTopicPdf } from "@/lib/supabase";

function reasonFromPdfError(
  error: PdfValidationError,
): Extract<IngestTopicPdfResponse, { ok: false }>["reason"] {
  if (error === "too-large") return "too-large";
  if (error === "too-many-pages") return "too-many-pages";
  return "invalid-pdf";
}

/** Client-side validate → Storage upload → server ingest. */
export async function attachTopicPdf(input: {
  userId: string;
  topicId: string;
  file: File;
  accessToken: string | null;
  onProgress?: (phase: "uploading" | "reading") => void;
}): Promise<IngestTopicPdfResponse> {
  const bytes = new Uint8Array(await input.file.arrayBuffer());
  const pdfError = validatePdfBytes(bytes, input.file.name);
  if (pdfError) {
    return {
      ok: false,
      reason: reasonFromPdfError(pdfError),
      message: pdfValidationMessage(pdfError),
    };
  }

  input.onProgress?.("uploading");
  try {
    await uploadTopicPdf(input.userId, input.topicId, bytes);
  } catch (error) {
    console.error("Failed to upload topic PDF:", error);
    return {
      ok: false,
      reason: "ingest-failed",
      message: "Couldn't attach this PDF. Please try again.",
    };
  }
  input.onProgress?.("reading");
  return ingestTopicPdf({
    data: {
      accessToken: input.accessToken,
      topicId: input.topicId,
      fileName: input.file.name,
    },
  });
}

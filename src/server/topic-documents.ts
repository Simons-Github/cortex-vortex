/**
 * Privileged reads/writes for `public.topic_documents` and the private
 * `topic-pdfs` Storage bucket. Always pass a user id from
 * `getAuthenticatedUser()` — never from the client body. Metadata writes
 * use the service_role client because authenticated clients have SELECT-only
 * RLS on the table.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { TOPIC_PDF_BUCKET, TOPIC_PDF_MAX_BRIEF_CHARS, topicPdfObjectPath } from "@/lib/pdf";
import { getServiceRoleClient } from "@/server/user-gemini-keys";

export type TopicDocumentStatus = "ready" | "failed";

export type TopicDocumentRow = {
  topic_id: string;
  user_id: string;
  file_name: string;
  byte_size: number;
  page_count: number | null;
  status: TopicDocumentStatus;
  failure_reason: string | null;
  study_brief: string | null;
  created_at: string;
  updated_at: string;
};

function requireServiceClient(): SupabaseClient {
  const client = getServiceRoleClient();
  if (!client) {
    throw new Error("Topic document store is not configured.");
  }
  return client;
}

export async function loadTopicDocument(
  topicId: string,
  userId: string,
): Promise<TopicDocumentRow | null> {
  const client = getServiceRoleClient();
  if (!client) return null;

  const { data, error } = await client
    .from("topic_documents")
    .select("*")
    .eq("topic_id", topicId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return (data as TopicDocumentRow | null) ?? null;
}

export async function downloadTopicPdf(
  userId: string,
  topicId: string,
): Promise<Uint8Array | null> {
  const client = getServiceRoleClient();
  if (!client) return null;

  const { data, error } = await client.storage
    .from(TOPIC_PDF_BUCKET)
    .download(topicPdfObjectPath(userId, topicId));
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

export async function deleteTopicPdfObject(userId: string, topicId: string): Promise<void> {
  const client = getServiceRoleClient();
  if (!client) return;

  const { error } = await client.storage
    .from(TOPIC_PDF_BUCKET)
    .remove([topicPdfObjectPath(userId, topicId)]);
  if (error) throw error;
}

export type UpsertTopicDocumentInput = {
  topicId: string;
  userId: string;
  fileName: string;
  byteSize: number;
  pageCount: number | null;
  status: TopicDocumentStatus;
  failureReason: string | null;
  studyBrief: string | null;
};

export async function upsertTopicDocument(input: UpsertTopicDocumentInput): Promise<void> {
  const client = requireServiceClient();
  const brief = input.studyBrief
    ? input.studyBrief.trim().slice(0, TOPIC_PDF_MAX_BRIEF_CHARS)
    : null;
  const reason = input.failureReason ? input.failureReason.trim().slice(0, 300) : null;

  const { error } = await client.from("topic_documents").upsert(
    {
      topic_id: input.topicId,
      user_id: input.userId,
      file_name: input.fileName.trim().slice(0, 200),
      byte_size: input.byteSize,
      page_count: input.pageCount,
      status: input.status,
      failure_reason: reason,
      study_brief: brief,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "topic_id" },
  );
  if (error) throw error;
}

export async function deleteTopicDocument(topicId: string, userId: string): Promise<void> {
  const client = requireServiceClient();
  const { error } = await client
    .from("topic_documents")
    .delete()
    .eq("topic_id", topicId)
    .eq("user_id", userId);
  if (error) throw error;
}

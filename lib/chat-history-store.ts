import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { historyUuid, type HistoryMessage } from "@/lib/chat-history";

export class HistoryError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export interface HistoryWrite { id: string; title: string; messages: HistoryMessage[]; create: boolean }
export function validateHistoryWrite(value: unknown): HistoryWrite {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HistoryError("Invalid conversation.");
  const body = value as Record<string, unknown>;
  if (!historyUuid(body.id) || typeof body.title !== "string" || !body.title.trim() || body.title.length > 80 || !Array.isArray(body.messages) || !body.messages.length || body.messages.length > 100 || typeof body.create !== "boolean") throw new HistoryError("Invalid conversation.");
  const messages = body.messages as HistoryMessage[];
  if (messages.some((message) => !message || !historyUuid(message.id) || !["me", "vivian"].includes(message.from) || typeof message.text !== "string" || !message.text.trim() || message.text.length > 16000 || typeof message.timestamp !== "string" || !Number.isFinite(Date.parse(message.timestamp)))) throw new HistoryError("Invalid conversation messages.");
  if (new Set(messages.map((message) => message.id)).size !== messages.length) throw new HistoryError("Duplicate message IDs.");
  return { id: body.id, title: body.title.trim(), messages, create: body.create };
}
export async function saveHistory(db: SupabaseClient, input: HistoryWrite): Promise<void> {
  const { error } = await db.rpc("vivian_save_conversation", {
    p_id: input.id, p_title: input.title, p_create: input.create,
    p_messages: input.messages.map((message) => ({ id: message.id, role: message.from === "me" ? "user" : "assistant", content: message.text, created_at: message.timestamp })),
  });
  if (error) throw new HistoryError(error.code === "P0002" ? "Conversation no longer exists. Start a new conversation." : "Chat history is temporarily unavailable.", error.code === "P0002" ? 409 : 503);
}
export async function listHistory(db: SupabaseClient, offset: number) {
  const { data, error } = await db.from("conversations").select("id,title,updated_at").eq("user_key", "default").order("updated_at", { ascending: false }).order("id").range(offset, offset + 49);
  if (error) throw new HistoryError("Chat history is temporarily unavailable.", 503);
  return { conversations: (data ?? []).map((row) => ({ id: row.id, title: row.title, updatedAt: Date.parse(row.updated_at), messages: [] })), nextOffset: data?.length === 50 ? offset + 50 : null };
}
export async function readHistory(db: SupabaseClient, id: string, after: string) {
  if (!historyUuid(id)) throw new HistoryError("Invalid conversation ID.");
  const { data: conversation, error: lookupError } = await db.from("conversations").select("id,title,updated_at").eq("id", id).eq("user_key", "default").maybeSingle();
  if (lookupError) throw new HistoryError("Chat history is temporarily unavailable.", 503);
  if (!conversation) throw new HistoryError("Conversation not found.", 404);
  const { data, error } = await db.from("messages").select("id,client_message_id,role,content,created_at").eq("conversation_id", id).gt("id", after).order("id").limit(100);
  if (error) throw new HistoryError("Chat history is temporarily unavailable.", 503);
  return { messages: (data ?? []).map((row) => ({ id: row.client_message_id, from: row.role === "user" ? "me" : "vivian", text: row.content, timestamp: row.created_at })), nextCursor: data?.length === 100 ? String(data.at(-1)!.id) : null };
}

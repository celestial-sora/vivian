import { authFetch } from "@/lib/auth/fetch";
import type { HistoryConversation, HistoryMessage } from "@/lib/chat-history";

async function requestHistory(url: string, init: RequestInit = {}) {
  const response = await authFetch(url, { ...init, cache: "no-store", signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Chat history is temporarily unavailable.");
  return data;
}
export async function fetchHistory(signal?: AbortSignal): Promise<HistoryConversation[]> {
  const result: HistoryConversation[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const page = await requestHistory(`/api/conversations?offset=${offset}`, { signal });
    result.push(...page.conversations);
    offset = page.nextOffset;
  }
  for (const conversation of result) {
    let after: string | null = "0";
    while (after !== null) {
      const page = await requestHistory(`/api/conversations?id=${conversation.id}&after=${after}`, { signal });
      conversation.messages.push(...page.messages.map((message: HistoryMessage) => ({ ...message, synced: true })));
      after = page.nextCursor;
    }
    conversation.messages.sort((a, b) => Date.parse(a.timestamp ?? "") - Date.parse(b.timestamp ?? ""));
    conversation.cloud = true;
  }
  return result;
}
export async function appendHistory(conversation: HistoryConversation, messages: HistoryMessage[], create: boolean): Promise<void> {
  await requestHistory("/api/conversations", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: conversation.id, title: conversation.title, messages, create }) });
}

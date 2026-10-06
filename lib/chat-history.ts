export interface HistoryMessage {
  id?: string;
  synced?: boolean;
  from: "me" | "vivian";
  text: string;
  timestamp?: string;
}
export interface HistoryConversation {
  id: string;
  title: string;
  updatedAt: number;
  messages: HistoryMessage[];
  cloud?: boolean;
}
export const HISTORY_CACHE_KEY = "vivian-conversations-v1";
export const HISTORY_ACTIVE_KEY = "vivian-active-conversation";
export const historyUuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function historyMessage(from: HistoryMessage["from"], text: string, id = crypto.randomUUID()): HistoryMessage {
  return { id, from, text, timestamp: new Date().toISOString() };
}
export function normalizeHistory(input: unknown): HistoryConversation[] {
  if (!Array.isArray(input)) return [];
  return input.filter((item) => item && typeof item.id === "string" && Array.isArray(item.messages)).map((item) => {
    const updatedAt = Number.isFinite(item.updatedAt) ? item.updatedAt : Date.now();
    return {
      id: historyUuid(item.id) ? item.id : crypto.randomUUID(),
      cloud: item.cloud === true,
      title: typeof item.title === "string" ? item.title.slice(0, 80) : "Daily Talk", updatedAt,
      messages: item.messages.filter((message: HistoryMessage) => message && ["me", "vivian"].includes(message.from) && typeof message.text === "string" && message.text.trim()).map((message: HistoryMessage, index: number) => ({
        ...message, id: historyUuid(message.id) ? message.id : crypto.randomUUID(),
        timestamp: message.timestamp && Number.isFinite(Date.parse(message.timestamp)) ? message.timestamp : new Date(updatedAt + index).toISOString(),
      })),
    };
  });
}
export function mergeHistory(remote: HistoryConversation[], local: HistoryConversation[]): HistoryConversation[] {
  const result = new Map(remote.map((conversation) => [conversation.id, conversation]));
  for (const conversation of local) {
    const cloud = result.get(conversation.id);
    if (!cloud) { result.set(conversation.id, conversation); continue; }
    const messages = new Map(conversation.messages.map((message) => [message.id, message]));
    // Server text wins for already persisted IDs. Local unsynced messages survive.
    for (const message of cloud.messages) messages.set(message.id, message);
    result.set(conversation.id, { ...cloud, updatedAt: Math.max(cloud.updatedAt, conversation.updatedAt), messages: [...messages.values()].sort((a, b) => Date.parse(a.timestamp ?? "") - Date.parse(b.timestamp ?? "")) });
  }
  return [...result.values()].sort((a, b) => b.updatedAt - a.updatedAt);
}

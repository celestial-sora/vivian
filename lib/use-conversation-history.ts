"use client";
import { scheduleBackgroundWork } from "@/lib/startup-background";
import { useCallback, useEffect, useRef, useReducer, type SetStateAction } from "react";
import { appendHistory, fetchHistory } from "@/lib/chat-history-client";
import { HISTORY_ACTIVE_KEY, HISTORY_CACHE_KEY, mergeHistory, normalizeHistory, type HistoryConversation, type HistoryMessage } from "@/lib/chat-history";

interface HistoryView {
  messages: HistoryMessage[];
  conversations: HistoryConversation[];
  activeConversationId: string;
  ready: boolean;
  notice: string | null;
}
type HistoryAction =
  | { kind: "messages"; value: SetStateAction<HistoryMessage[]>; pendingText: string }
  | { kind: "conversations"; value: HistoryConversation[] }
  | { kind: "active"; value: string }
  | { kind: "ready"; value: boolean }
  | { kind: "notice"; value: string | null };
function historyReducer(view: HistoryView, action: HistoryAction): HistoryView {
  if (action.kind === "messages") {
    const messages = typeof action.value === "function" ? action.value(view.messages) : action.value;
    if (!view.ready || !view.activeConversationId) return { ...view, messages };
    const filtered = messages.filter((message) => message.text !== action.pendingText);
    const existing = view.conversations.find((item) => item.id === view.activeConversationId);
    const firstUser = filtered.find((message) => message.from === "me");
    const title = existing?.title && existing.title !== "Daily Talk" ? existing.title : firstUser?.text.slice(0, 42) ?? "Daily Talk";
    const updatedAt = Math.max(existing?.updatedAt ?? 0, ...filtered.map((message) => Date.parse(message.timestamp ?? "") || 0));
    const item = { id: view.activeConversationId, title, updatedAt: updatedAt || Date.now(), messages: filtered, cloud: existing?.cloud };
    return { ...view, messages, conversations: [item, ...view.conversations.filter((conversation) => conversation.id !== item.id)] };
  }
  if (action.kind === "conversations") return { ...view, conversations: action.value };
  if (action.kind === "active") return { ...view, activeConversationId: action.value };
  if (action.kind === "ready") return { ...view, ready: action.value };
  return { ...view, notice: action.value };
}
export function useConversationHistory(initial: HistoryMessage, pendingText: string, busy: boolean) {
  const initialRef = useRef(initial);
  const cloudRestoreId = useRef<string | null>(null);
  const [view, dispatch] = useReducer(historyReducer, { messages: [initial], conversations: [], activeConversationId: "", ready: false, notice: null });
  const { messages, conversations, activeConversationId, ready, notice } = view;
  const setMessages = useCallback((value: SetStateAction<HistoryMessage[]>) => dispatch({ kind: "messages", value, pendingText }), [pendingText]);
  const setConversations = useCallback((value: HistoryConversation[]) => dispatch({ kind: "conversations", value }), []);
  const setActiveConversationId = useCallback((value: string) => dispatch({ kind: "active", value }), []);
  const setReady = useCallback((value: boolean) => dispatch({ kind: "ready", value }), []);
  const setNotice = useCallback((value: string | null) => dispatch({ kind: "notice", value }), []);
  const state = useRef({ conversations, activeConversationId, messages, busy, ready });
  useEffect(() => { state.current = { conversations, activeConversationId, messages, busy, ready }; }, [conversations, activeConversationId, messages, busy, ready]);
  const paused = useRef(false), mounted = useRef(false), generation = useRef(0);
  const saving = useRef<Promise<void> | null>(null);
  const refreshing = useRef(false), refreshCount = useRef(0), cloudAvailable = useRef(false);
  const acknowledged = useRef(new Set<string>()), known = useRef(new Set<string>());
  const cache = useCallback((items: HistoryConversation[]) => {
    const saved = items.map((item) => ({ ...item, cloud: known.current.has(item.id) || item.cloud, messages: item.messages.map((message) => ({ ...message, synced: message.synced || acknowledged.current.has(message.id!) })) }));
    try { localStorage.setItem(HISTORY_CACHE_KEY, JSON.stringify(saved)); } catch { /* Cloud remains primary when browser storage is unavailable. */ }
  }, []);
  const sync = useCallback(async (): Promise<void> => {
    if (paused.current || !state.current.ready) return;
    if (saving.current) return saving.current;
    const currentGeneration = generation.current;
    const work = async () => {
      try {
        for (const conversation of state.current.conversations) {
          // A fresh welcome stays ephemeral until the user speaks.
          if (!conversation.messages.some((message) => message.from === "me")) continue;
          const pending = conversation.messages.filter((message) => !message.synced && !acknowledged.current.has(message.id!));
          for (let index = 0; index < pending.length; index += 100) {
            if (paused.current || generation.current !== currentGeneration) return;
            const batch = pending.slice(index, index + 100);
            await appendHistory(conversation, batch, !known.current.has(conversation.id) && !conversation.cloud);
            cloudAvailable.current = true;
            known.current.add(conversation.id);
            batch.forEach((message) => acknowledged.current.add(message.id!));
            cache(state.current.conversations);
          }
        }
        if (mounted.current && generation.current === currentGeneration) if (cloudAvailable.current) setNotice(null);
      } catch {
        if (mounted.current && generation.current === currentGeneration) setNotice("ยังซิงก์แชตไม่ได้ เก็บสำรองบนอุปกรณ์นี้และจะลองใหม่");
      }
    };
    saving.current = work();
    try { await saving.current; } finally { saving.current = null; }
  }, [cache, setNotice]);
  const refresh = useCallback(async (signal?: AbortSignal): Promise<void> => {
    if (paused.current || refreshing.current || (state.current.ready && state.current.busy)) return;
    refreshing.current = true;
    const refreshId = ++refreshCount.current;
    const currentGeneration = generation.current;
    try {
      const cloud = await fetchHistory(signal);
      if (!mounted.current || signal?.aborted || generation.current !== currentGeneration || paused.current) return;
      cloudAvailable.current = true;
      for (const conversation of cloud) {
        known.current.add(conversation.id);
        conversation.messages.forEach((message) => acknowledged.current.add(message.id!));
      }
      const ids = new Set(cloud.map((item) => item.id));
      const local = state.current.conversations.filter((item) => (!item.cloud && !known.current.has(item.id)) || ids.has(item.id) || item.messages.some((message) => !message.synced && !acknowledged.current.has(message.id!)));
      const merged = mergeHistory(cloud, local);
      setConversations(merged);
      // A pristine device can restore the latest cloud thread after its local
      // composer becomes ready. Explicit navigation or a user turn wins.
      const restoreInitial = cloudRestoreId.current === state.current.activeConversationId && !state.current.messages.some((message) => message.from === "me");
      const active = (restoreInitial ? cloud[0] : undefined) ?? merged.find((item) => item.id === state.current.activeConversationId);
      cloudRestoreId.current = null;
      if (!state.current.busy && active) {
        setActiveConversationId(active.id);
        setMessages(active.messages.length ? active.messages : [initialRef.current]);
      }
      cache(merged);
      setNotice(null);
    } catch {
      if (mounted.current && !signal?.aborted && generation.current === currentGeneration) setNotice("โหลดประวัติจากคลาวด์ไม่ได้ กำลังใช้แชตสำรองบนอุปกรณ์นี้");
    } finally {
      if (refreshId === refreshCount.current) refreshing.current = false;
      if (mounted.current && !signal?.aborted && generation.current === currentGeneration) setReady(true);
    }
  }, [cache, setConversations, setActiveConversationId, setMessages, setNotice, setReady]);
  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    let cancelInitial: (() => void) | undefined;
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      let cached: HistoryConversation[] = [], selected: string | null = null;
      try {
        const raw = JSON.parse(localStorage.getItem(HISTORY_CACHE_KEY) ?? "[]");
        cached = normalizeHistory(raw);
        const storedActive = localStorage.getItem(HISTORY_ACTIVE_KEY);
        const index = Array.isArray(raw) ? raw.findIndex((item) => item.id === storedActive) : -1;
        selected = cached[index]?.id ?? cached[0]?.id ?? null;
        cached.forEach((item) => { if (item.cloud) known.current.add(item.id); item.messages.forEach((message) => { if (message.synced) acknowledged.current.add(message.id!); }); });
      } catch { /* Corrupt caches must not block chat. */ }
      const id = selected ?? crypto.randomUUID();
      cloudRestoreId.current = selected ? null : id;
      state.current.conversations = cached;
      state.current.activeConversationId = id;
      setConversations(cached); setActiveConversationId(id);
      const existing = cached.find((item) => item.id === id);
      if (existing?.messages.length) setMessages(existing.messages);
      cache(cached); // Persist migration UUIDs before any network writes.
      setReady(true); // The local conversation and composer are immediately usable.
      cancelInitial = scheduleBackgroundWork(() => { void refresh(controller.signal); });
    });
    const retry = () => { void sync().then(() => refresh(controller.signal)); };
    window.addEventListener("online", retry); window.addEventListener("focus", retry);
    const timer = window.setInterval(retry, 30_000);
    return () => { cancelInitial?.(); mounted.current = false; refreshCount.current += 1; refreshing.current = false; controller.abort(); clearInterval(timer); window.removeEventListener("online", retry); window.removeEventListener("focus", retry); };
  }, [cache, refresh, sync, setConversations, setActiveConversationId, setMessages, setReady]);
  useEffect(() => {
    if (!ready || !activeConversationId || paused.current) return;
    cache(conversations);
    try { localStorage.setItem(HISTORY_ACTIVE_KEY, activeConversationId); } catch { /* Optional cache. */ }
  }, [conversations, activeConversationId, ready, cache]);
  useEffect(() => {
    if (!ready || paused.current) return;
    const timer = setTimeout(() => { void sync(); }, 300);
    return () => clearTimeout(timer);
  }, [conversations, ready, sync]);
  const pause = useCallback(async () => { paused.current = true; generation.current += 1; await saving.current; }, []);
  const clear = useCallback(() => {
    acknowledged.current.clear(); known.current.clear();
    setNotice(null);
    setConversations([]); setActiveConversationId(crypto.randomUUID()); setMessages([]);
    state.current.conversations = [];
    try { localStorage.removeItem(HISTORY_CACHE_KEY); localStorage.removeItem(HISTORY_ACTIVE_KEY); } catch { /* Optional cache. */ }
  }, [setConversations, setActiveConversationId, setMessages, setNotice]);
  const resume = useCallback(() => { paused.current = false; }, []);
  return { messages, setMessages, conversations, activeConversationId, setActiveConversationId, ready, notice, refresh, pause, clear, resume, isCloudConversation: (id: string) => known.current.has(id) };
}

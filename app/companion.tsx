"use client";

import { useEffect, useRef, useState } from "react";
import { captureModelRestState, restoreModelRestState, type ModelRestState, type CubismRestModel } from "@/lib/model-rest-state";
import { authFetch } from "@/lib/auth/fetch";
import { decayCompanionState, type CompanionState, defaultCompanionState, normalizeMood, moodLabel, type Mood } from "@/lib/companion";
import { MODEL_CONFIG, type ModelKey } from "@/lib/models";
import { createModelResources, importModelFiles, loadModelPackages, removeModelPackage, saveModelPackage, type ModelPackage, type ModelMotion } from "@/lib/local-models";
import { getCloudModels, cloudModelPlaceholder, uploadCloudModel, downloadCloudModel, deleteCloudModel, type CloudLibrary } from "@/lib/cloud-models";
import { useSceneLibrary } from "@/lib/use-scene-library";
import { SceneManager } from "@/app/components/scene-manager";
import { SceneBackground } from "@/app/components/scene-background";
import { StorageStatusPanel } from "@/app/components/storage-status";
import type { SceneDecision } from "@/lib/scenes";

type IconName = "config" | "info" | "wardrobe" | "chevron" | "mic" | "micOff" | "video" | "clip" | "message" | "send" | "close" | "memory" | "sound" | "language" | "status" | "scene" | "plus" | "search" | "sun" | "moon";

function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  const iconUrl = `/icons/${name}.svg`;
  return <span className="app-icon" style={{ width: size, height: size, maskImage: `url("${iconUrl}")`, WebkitMaskImage: `url("${iconUrl}")` }} aria-hidden="true" />;
}

type Message = { from: "me" | "vivian"; text: string; timestamp?: string };
type Memory = { id: number; memory: string; category: string; importance: number };
type Panel = "conversations" | "memories" | "character" | "scenes" | "voice" | "status" | "settings";
type Conversation = { id: string; title: string; updatedAt: number; messages: Message[] };
const CONVERSATIONS_KEY = "vivian-conversations-v1";
type SpeechLanguage = "global" | "th" | "en" | "ja" | "ko" | "zh";
const LANGUAGE_OPTIONS: Array<{ code: SpeechLanguage; label: string; nativeName: string }> = [
  { code: "global", label: "ทุกภาษา", nativeName: "Global" },
  { code: "th", label: "Thai", nativeName: "TH" },
  { code: "en", label: "English", nativeName: "EN" },
  { code: "ja", label: "Japanese", nativeName: "JP" },
  { code: "ko", label: "Korean", nativeName: "KR" },
  { code: "zh", label: "Chinese", nativeName: "CN" },
];
const greetings = [
  "...มีอะไรมาเล่าให้หนูฟังไหมคะ หนูฟังอยู่นะ...",
  "...วันนี้ที่โรงเรียนเป็นยังไงบ้างคะ มีอะไรอยากเล่าให้หนูฟังไหม...",
  "...มีเรื่องอยากคุยเหรอคะ เล่าให้หนูฟังได้นะ ไม่ต้องเกร็ง...",
];
const greeting = (): Message => ({ from: "vivian", text: greetings[Math.floor(Math.random() * greetings.length)] });
const GREETING_PENDING = "Vivian กำลังคิดคำทักทายให้คุณ...";
const BACKGROUNDS = { day: "/backgrounds/christmas-day-4x3.jpg", night: "/backgrounds/christmas-night-4x3.jpg" } as const;
const APP_CODENAME = "Sandrome";
const SILENT_WAV = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";
const CHAT_TIMEOUT_MS = 35000;
// The server aborts Fish at 14 seconds. Give the response a small transport
// margin, then always release the sending state instead of leaving "Thinking".
const TTS_TIMEOUT_MS = 17000;
const STT_TIMEOUT_MS = 20000;
const AUDIO_UNLOCK_MS = 1200;
const PLAYBACK_START_MS = 2500;
const AUDIO_SYNC_SETTLE_MS = 140;
const MIN_RECORDING_MS = 550;
const MIN_SPEECH_MS = 320;
const IDLE_AFTER_MS = 75_000;
const IDLE_COOLDOWN_MS = 8 * 60 * 1000;
const LAST_IDLE_KEY = "vivian-last-idle";
const VISION_MIN_INTERVAL_MS = 5000;
const VISION_MAX_INTERVAL_MS = 10000;
const VISION_COOLDOWN_MS = 6000;

function abortAfter(ms: number) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") return AbortSignal.timeout(ms);
  const controller = new AbortController();
  window.setTimeout(() => controller.abort(), ms);
  return controller.signal;
}

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T) {
  let timer: number | undefined;
  return Promise.race([
    promise,
    new Promise<T>((resolve) => { timer = window.setTimeout(() => resolve(fallback), ms); }),
  ]).finally(() => { if (timer) window.clearTimeout(timer); });
}

export default function Companion({ accountEmail, accountId }: { accountEmail: string; accountId: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pixiAppRef = useRef<any>(null);
  const modelRef = useRef<any>(null);
  const modelRestStateRef = useRef<ModelRestState | null>(null);
  const modelLoadIdRef = useRef(0);
  const expressionActionRef = useRef(0);
  const motionActionRef = useRef(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recordingStartedAtRef = useRef(0);
  const voiceAnalyserRef = useRef<AnalyserNode | null>(null);
  const voiceSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const voiceMonitorRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioUnlockPromiseRef = useRef<Promise<void> | null>(null);
  const audioPrimedRef = useRef(false);
  const mediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const lipSyncFrameRef = useRef<number | null>(null);
  const speakIdRef = useRef(0);
  const greetingSpokenRef = useRef(false);
  const greetingRequestRef = useRef<AbortController | null>(null);
  const greetingGenerationRef = useRef(0);
  const greetingTextRef = useRef<string | null>(null);
  const audioUnlockedByUserRef = useRef(false);
  const ttsAbortRef = useRef<AbortController | null>(null);
  const sendingRef = useRef(false);
  const resettingRef = useRef(false);
  const memoryGenerationRef = useRef(0);
  const speakingRef = useRef(false);
  const mutedRef = useRef(false);
  const recordingRef = useRef(false);
  const micEnabledRef = useRef(false);
  const interactedRef = useRef(false);
  const lastActivityRef = useRef(Date.now());
  const idleBusyRef = useRef(false);
  const speechSpeedRef = useRef(.98);
  const speechLanguageRef = useRef<SpeechLanguage>("th");
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraActiveRef = useRef(false);
  const lastVisionTriggerRef = useRef(0);
  const visionTimerRef = useRef<number | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<"user" | "environment">("user");
  const [attachedImage, setAttachedImage] = useState<string | null>(null);
  cameraActiveRef.current = cameraActive;
  // Keep the first server/client render identical while the greeting loads.
  const initialGreeting = useRef<Message>({ from: "vivian", text: GREETING_PENDING });
  const messagesRef = useRef<Message[]>([initialGreeting.current]);
  const companionRef = useRef<CompanionState>(defaultCompanionState());
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState<Message[]>([initialGreeting.current]);
  const [historyMessages, setHistoryMessages] = useState<Message[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [recording, setRecording] = useState(false);
  const [muted, setMuted] = useState(false);
  const [sending, setSending] = useState(false);
  const [sttPreview, setSttPreview] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [panel, setPanel] = useState<Panel | null>(null);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState("daily-talk");
  const [greetingTrigger, setGreetingTrigger] = useState(0);
  const activeConversationRef = useRef("daily-talk");
  const [conversationSearch, setConversationSearch] = useState("");
  const [characterTab, setCharacterTab] = useState<"outfit" | "expression" | "pose">("outfit");
  const [languageOpen, setLanguageOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const selectedModel: ModelKey = "Miss";
  const [modelPackages, setModelPackages] = useState<ModelPackage[]>([]);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [modelsReady, setModelsReady] = useState(false);
  const [modelImporting, setModelImporting] = useState(false);
  const [modelStatus, setModelStatus] = useState<"empty" | "loading" | "ready" | "error">("empty");
  const [modelNotice, setModelNotice] = useState<string | null>(null);
  const [cloudLibrary, setCloudLibrary] = useState<CloudLibrary | null>(null);
  const [modelPreview, setModelPreview] = useState<string | null>(null);
  const [textureQuality, setTextureQuality] = useState<"auto" | "original">("auto");
  const [textureSummary, setTextureSummary] = useState<string | null>(null);
  const [activeExpression, setActiveExpression] = useState<string | null>(null);
  const [activeMotion, setActiveMotion] = useState<string | null>(null);
  const modelZipRef = useRef<HTMLInputElement>(null);
  const modelFolderRef = useRef<HTMLInputElement>(null);
  const activePackage = modelPackages.find((pack) => pack.models.some((model) => model.id === activeModelId));
  const activeModel = activePackage?.models.find((model) => model.id === activeModelId);
  const [preferencesReady, setPreferencesReady] = useState(false);
  const [companion, setCompanion] = useState<CompanionState>(defaultCompanionState());
  const [customInstructions, setCustomInstructions] = useState("");
  const [jevConfigured, setJevConfigured] = useState<boolean | null | undefined>(undefined);
  const [editingMemoryId, setEditingMemoryId] = useState<number | null>(null);
  const [memoryDraft, setMemoryDraft] = useState("");
  const [backgroundMode, setBackgroundMode] = useState<keyof typeof BACKGROUNDS>("day");
  const sceneLibrary = useSceneLibrary();
  const activeCustomSceneId = sceneLibrary.preferences.activeSceneId;
  const selectedPreset = sceneLibrary.preferences.preset ?? backgroundMode;
  const [speechSpeed, setSpeechSpeed] = useState(.98);
  const [speechLanguage, setSpeechLanguage] = useState<SpeechLanguage>("th");
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [resetConfirming, setResetConfirming] = useState(false);
  const [resetNotice, setResetNotice] = useState<string | null>(null);
  const [streak, setStreak] = useState(0);
  const lastVivianMessage = messages.filter((item) => item.from === "vivian").at(-1)?.text ?? initialGreeting.current.text;
  messagesRef.current = messages;
  activeConversationRef.current = activeConversationId;
  sendingRef.current = sending;
  mutedRef.current = muted;
  speechSpeedRef.current = speechSpeed;
  speechLanguageRef.current = speechLanguage;
  companionRef.current = companion;

  useEffect(() => {
    const hour = new Date().getHours();
    setBackgroundMode(hour >= 6 && hour < 18 ? "day" : "night");
  }, []);

  function selectPresetScene(scene: keyof typeof BACKGROUNDS) {
    void sceneLibrary.updatePreferences({ preset: scene });
  }


  useEffect(() => {
    if (!sidebarOpen || panel !== "conversations") return;
    const refresh = window.setInterval(() => { void loadMemory(); }, 3000);
    return () => window.clearInterval(refresh);
  }, [sidebarOpen, panel]);

  useEffect(() => {
    if (!sidebarOpen || panel !== "settings") return;
    const controller = new AbortController();
    authFetch("/api/jev/status", { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((data: { configured?: boolean } | null) => { if (!controller.signal.aborted) setJevConfigured(data?.configured ?? null); })
      .catch(() => { if (!controller.signal.aborted) setJevConfigured(null); });
    return () => controller.abort();
  }, [sidebarOpen, panel]);

  useEffect(() => {
    try {
      const saved = JSON.parse(window.localStorage.getItem(CONVERSATIONS_KEY) ?? "[]");
      const valid: Conversation[] = Array.isArray(saved) ? saved.filter((item) => typeof item.id === "string" && Array.isArray(item.messages)) : [];
      setConversations(valid);
      const active = window.localStorage.getItem("vivian-active-conversation");
      if (active) {
        setActiveConversationId(active);
        const previous = valid.find((item) => item.id === active);
        if (previous?.messages.length) setMessages(previous.messages);
      }
    } catch { /* Corrupt local history must not block Vivian. */ }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    void (async () => {
      const [local, remote] = await Promise.allSettled([loadModelPackages(), getCloudModels(AbortSignal.any([controller.signal, AbortSignal.timeout(12_000)]))]);
      if (cancelled) return;
      const cloud = remote.status === "fulfilled" ? remote.value : null;
      setCloudLibrary(cloud);
      const packages = (local.status === "fulfilled" ? local.value : []).filter((pack) => !pack.cloudOwner || (pack.cloudOwner === accountId && (!cloud || cloud.models.some((model) => model.id === pack.id))));
      for (const model of cloud?.models ?? []) if (!packages.some((pack) => pack.id === model.id)) packages.push(cloudModelPlaceholder(model));
      setModelPackages(packages);
      if (!cloud) setModelNotice("Cloud sync is unavailable. Models saved on this device still work.");
      const saved = localStorage.getItem("vivian-local-model");
      const selected = packages.some((pack) => pack.models.some((model) => model.id === saved)) ? saved : packages[0]?.models[0]?.id ?? null;
      const pack = packages.find((entry) => entry.models.some((model) => model.id === selected));
      if (pack && !pack.assets.length && cloud) {
        try {
          const downloaded = await downloadCloudModel(cloud.models.find((model) => model.id === pack.id)!, cloud.userId, controller.signal);
          if (cancelled) return;
          packages.splice(packages.indexOf(pack), 1, downloaded);
          setModelPackages([...packages]);
          await saveModelPackage(downloaded).catch(() => {});
        } catch { if (!cancelled) setModelNotice("Could not load the cloud model. Select it again to retry."); return; }
      }
      if (!cancelled) setActiveModelId(selected);
    })().catch(() => {
      if (!cancelled) setModelNotice("Model storage is unavailable. Please try again.");
    }).finally(() => { if (!cancelled) setModelsReady(true); });
    return () => { cancelled = true; controller.abort(); };
  }, [accountId]);

  useEffect(() => {
    if (!modelsReady) return;
    if (activeModelId) localStorage.setItem("vivian-local-model", activeModelId);
    else localStorage.removeItem("vivian-local-model");
  }, [modelsReady, activeModelId]);

  useEffect(() => {
    setModelPreview(null);
    if (!activeModel?.previewPath || !activePackage) return;
    const image = activePackage.assets.find((asset) => asset.path === activeModel.previewPath);
    if (!image) return;
    const url = URL.createObjectURL(image.blob);
    setModelPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [activeModel, activePackage]);

  async function importModels(files: File[]) {
    if (modelImporting || !files.length) return;
    setModelImporting(true);
    setModelNotice(null);
    try {
      const pack = await importModelFiles(files);
      await saveModelPackage(pack);
      setModelPackages((current) => [...current, pack]);
      setActiveModelId(pack.models[0].id);
      void navigator.storage?.persist?.().catch(() => {});
      if (cloudLibrary) await syncModelToCloud(pack, files.length === 1 && /\.zip$/i.test(files[0].name) ? files[0] : undefined);
    } catch (error) {
      setModelNotice(error instanceof Error ? error.message : "Could not import this model.");
    } finally { setModelImporting(false); }
  }

  async function syncModelToCloud(pack: ModelPackage, originalZip?: File) {
    const saved = await uploadCloudModel(pack, setModelNotice, originalZip);
    // Commit the new cache before discarding the existing local-only package.
    await saveModelPackage(saved.pack).catch(() => {});
    setModelPackages((current) => current.map((entry) => entry.id === pack.id ? saved.pack : entry));
    setActiveModelId(saved.pack.models.find((model) => model.manifestPath === activeModel?.manifestPath)?.id ?? saved.pack.models[0].id);
    setCloudLibrary((current) => current ? { ...current, usage: saved.usage, models: [...current.models, { id: saved.pack.id, byteSize: 0, manifests: saved.pack.models.map((model) => ({ path: model.manifestPath, name: model.name })) }] } : current);
    await removeModelPackage(pack.id).catch(() => {});
    setModelNotice("Model saved privately to cloud.");
  }

  async function saveActiveModelToCloud() {
    if (!activePackage || modelImporting || !cloudLibrary) return;
    setModelImporting(true);
    try { await syncModelToCloud(activePackage); }
    catch (error) { setModelNotice(error instanceof Error ? error.message : "Could not save model to cloud."); }
    finally { setModelImporting(false); }
  }

  async function chooseModel(id: string) {
    if (modelImporting) return;
    const pack = modelPackages.find((entry) => entry.models.some((model) => model.id === id));
    if (!pack) return;
    setModelNotice(null);
    if (!pack.assets.length && cloudLibrary) {
      setModelImporting(true); setModelNotice("Loading model from private cloud storage…");
      try {
        const downloaded = await downloadCloudModel(cloudLibrary.models.find((model) => model.id === pack.id)!, cloudLibrary.userId);
        await saveModelPackage(downloaded).catch(() => {});
        setModelPackages((current) => current.map((entry) => entry.id === pack.id ? downloaded : entry));
        setActiveModelId(id); setModelNotice(null);
      } catch (error) { setModelNotice(error instanceof Error ? error.message : "Could not load model."); }
      finally { setModelImporting(false); }
    } else setActiveModelId(id);
  }

  async function removeActiveModel() {
    if (!activePackage || modelImporting) return;
    setModelImporting(true);
    try {
      if (cloudLibrary?.models.some((model) => model.id === activePackage.id)) {
        await deleteCloudModel(activePackage.id);
        setCloudLibrary((current) => current ? { ...current, models: current.models.filter((model) => model.id !== activePackage.id) } : current);
        void getCloudModels().then(setCloudLibrary).catch(() => {});
      }
      await removeModelPackage(activePackage.id);
      const remaining = modelPackages.filter((pack) => pack.id !== activePackage.id);
      setModelPackages(remaining);
      setActiveModelId(remaining[0]?.models[0]?.id ?? null);
      setModelNotice(null);
    } catch { setModelNotice("Could not remove the saved model. Please try again."); }
    finally { setModelImporting(false); }
  }

  async function selectExpression(expression: string | null) {
    if (expression === null) { resetReaction(); return; }
    const actionId = ++expressionActionRef.current;
    const loadId = modelLoadIdRef.current;
    try {
      if (!modelRef.current) return;
      setModelNotice(null);
      // Select immediately so a second click can cancel an expression still loading.
      setActiveExpression(expression);
      const started = await modelRef.current.expression(expression);
      if (actionId !== expressionActionRef.current || loadId !== modelLoadIdRef.current) return;
      if (!started) throw new Error("Expression unavailable");
    } catch {
      if (actionId === expressionActionRef.current && loadId === modelLoadIdRef.current) {
        resetReaction();
        setModelNotice("This expression could not be played.");
      }
    }
  }

  async function selectMotion(motion: ModelMotion | null) {
    const actionId = ++motionActionRef.current;
    const loadId = modelLoadIdRef.current;
    try {
      const manager = modelRef.current?.internalModel?.motionManager;
      if (!manager) return;
      manager.stopAllMotions();
      setModelNotice(null);
      setActiveMotion(motion ? `${motion.group}:${motion.index}` : null);
      if (!motion && modelRestStateRef.current) {
        restoreModelRestState(modelRef.current.internalModel.coreModel, modelRestStateRef.current);
      }
      if (motion) {
        const started = await modelRef.current.motion(motion.group, motion.index, 3);
        if (actionId !== motionActionRef.current || loadId !== modelLoadIdRef.current) return;
        if (!started) throw new Error("Motion unavailable");
      }
    } catch {
      if (actionId === motionActionRef.current && loadId === modelLoadIdRef.current) {
        setActiveMotion(null);
        setModelNotice("This motion could not be played.");
      }
    }
  }

  useEffect(() => {
    if (!preferencesReady) return;
    setConversations((current) => {
      const existing = current.find((item) => item.id === activeConversationId);
      const next = [{ id: activeConversationId, title: existing?.title === "Daily Talk" ? messages.find((item) => item.from === "me")?.text.slice(0, 42) ?? existing.title : existing?.title ?? messages.find((item) => item.from === "me")?.text.slice(0, 42) ?? "Daily Talk", updatedAt: Date.now(), messages }, ...current.filter((item) => item.id !== activeConversationId)].slice(0, 30);
      try { window.localStorage.setItem(CONVERSATIONS_KEY, JSON.stringify(next)); } catch { /* Private mode or storage quota. */ }
      return next;
    });
  }, [messages, activeConversationId, preferencesReady]);

  useEffect(() => {
    if (!preferencesReady) return;
    if (messagesRef.current.length !== 1 || messagesRef.current[0].text !== GREETING_PENDING) return;
    const previousSession = conversations
      .filter((item) => item.id !== activeConversationId && item.messages.some((entry) => entry.from === "me"))
      .sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const previousMessages = previousSession?.messages
      .filter((item) => item.text !== GREETING_PENDING && item.text !== "[ส่งรูปภาพ]")
      .slice(-6)
      .map((item) => ({ role: item.from === "me" ? "user" : "assistant", content: item.text.slice(0, 500) })) ?? [];
    const conversationId = activeConversationId;
    const requestId = ++greetingGenerationRef.current;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, CHAT_TIMEOUT_MS);
    greetingRequestRef.current = controller;
    greetingTextRef.current = null;
    greetingSpokenRef.current = false;
    void (async () => {
      try {
        const response = await authFetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({ mode: "greeting", messages: previousMessages, character: selectedModel, customInstructions, language: speechLanguageRef.current }),
        });
        if (!response.ok) throw new Error("Greeting unavailable");
        const data = await response.json() as { text?: string };
        const text = data.text?.trim();
        if (!text) throw new Error("Empty greeting");
        if (requestId !== greetingGenerationRef.current || activeConversationRef.current !== conversationId || messagesRef.current[0]?.text !== GREETING_PENDING) return;
        greetingTextRef.current = text;
        setMessages((current) => current.length === 1 && current[0].from === "vivian" ? [{ from: "vivian", text }] : [...current, { from: "vivian", text }]);
        if (audioUnlockedByUserRef.current && !mutedRef.current && !greetingSpokenRef.current) {
          greetingSpokenRef.current = true;
          void speak(text);
        }
      } catch {
        if ((timedOut || !controller.signal.aborted) && requestId === greetingGenerationRef.current && activeConversationRef.current === conversationId && messagesRef.current[0]?.text === GREETING_PENDING) {
          const fallback = greeting();
          setMessages((current) => current.length === 1 && current[0].text === GREETING_PENDING ? [fallback] : [...current, fallback]);
          if (audioUnlockedByUserRef.current && !mutedRef.current && !greetingSpokenRef.current) {
            greetingSpokenRef.current = true;
            void speak(fallback.text);
          }
        }
      } finally {
        window.clearTimeout(timeout);
        if (greetingRequestRef.current === controller) greetingRequestRef.current = null;
      }
    })();
    return () => controller.abort();
  }, [preferencesReady, greetingTrigger]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") { setPanel(null); setSidebarOpen(false); } };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sidebarOpen]);

  useEffect(() => {
    const storedLanguage = window.localStorage.getItem("vivian-speech-language");
    if (LANGUAGE_OPTIONS.some((option) => option.code === storedLanguage)) setSpeechLanguage(storedLanguage as SpeechLanguage);
    setCustomInstructions(window.localStorage.getItem("vivian-custom-instructions") ?? "");
    const today = new Date().toISOString().slice(0, 10);
    const lastCheckIn = window.localStorage.getItem("vivian-checkin-date");
    const previousStreak = Number(window.localStorage.getItem("vivian-streak") ?? 0);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const nextStreak = lastCheckIn === today ? previousStreak : lastCheckIn === yesterday ? previousStreak + 1 : 1;
    if (lastCheckIn !== today) window.localStorage.setItem("vivian-checkin-date", today);
    window.localStorage.setItem("vivian-streak", String(nextStreak));
    setStreak(nextStreak);
    setPreferencesReady(true);
  }, []);

  useEffect(() => {
    // Warm every scene into the browser cache before the first reaction can
    // request a swap. This prevents a network fetch from delaying the fade.
  }, []);

  useEffect(() => {
    const unlock = () => {
      audioUnlockedByUserRef.current = true;
      void unlockAudio();
      if (greetingTextRef.current && !greetingSpokenRef.current && !mutedRef.current) {
        greetingSpokenRef.current = true;
        void speak(greetingTextRef.current);
      }
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    void loadMemory();
    const idleTimer = window.setInterval(() => { void maybeIdleGreeting(); }, 12000);
    const onVisible = () => { lastActivityRef.current = Date.now(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.clearInterval(idleTimer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    if (!preferencesReady || !modelsReady) return;
    setActiveExpression(null);
    setActiveMotion(null);
    if (!activeModel || !activePackage) { setModelStatus("empty"); return; }
    setModelStatus("loading");
    setTextureSummary(null);
    const textureAbort = new AbortController();
    let releaseResources: (() => void) | undefined;
    let app: any;
    let resizeModel = () => {};
    let queueResize = () => {};
    let handleOrientationChange = () => {};
    let resizeFrame: number | undefined;
    let resizeTimeout: number | undefined;
    let disposed = false;
    const loadId = ++modelLoadIdRef.current;
    void (async () => {
      try {
        const PIXI = await import("pixi.js");
        const { Live2DModel, Cubism4ModelSettings } = await import("pixi-live2d-display/cubism4");
        if (!canvasRef.current || disposed) return;
        const isAppleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
        // Keep the 4096 textures intact, but render the canvas above CSS
        // resolution on iPad/iPhone so the model is not visibly soft. The
        // 1.5 cap is a deliberate memory/performance guard for Safari.
        const appleResolution = Math.min(Math.max(window.devicePixelRatio || 1, 1), 1.5);
        (window as any).PIXI = PIXI;
        (Live2DModel as any).registerTicker(PIXI.Ticker);
        app = pixiAppRef.current;
        if (!app) {
          app = new PIXI.Application({
            view: canvasRef.current,
            backgroundAlpha: 0,
            antialias: !isAppleMobile,
            autoDensity: true,
            resolution: isAppleMobile ? appleResolution : Math.min(window.devicePixelRatio || 1, 2),
            powerPreference: isAppleMobile ? "low-power" : "high-performance",
          });
          app.ticker.maxFPS = isAppleMobile ? 30 : 60;
          pixiAppRef.current = app;
        }
        const previousModel = modelRef.current;
        if (previousModel) {
          app.stage.removeChild(previousModel);
          previousModel.destroy({ children: true, texture: true, baseTexture: true });
          modelRef.current = null;
          modelRestStateRef.current = null;
        }
        const maxTextureSize = app.renderer.gl.getParameter(app.renderer.gl.MAX_TEXTURE_SIZE) as number;
        canvasRef.current.dataset.gpuTextureLimit = String(maxTextureSize);
        const mobileDevice = isAppleMobile || /Android|Mobile/i.test(navigator.userAgent);
        const resources = await createModelResources(activePackage, activeModel, {
          maxDimension: maxTextureSize,
          budgetBytes: (mobileDevice ? 128 : 512) * 1024 * 1024,
          original: textureQuality === "original",
          signal: textureAbort.signal,
        });
        releaseResources = resources.dispose;
        if (disposed) { resources.dispose(); return; }
        const settings = new Cubism4ModelSettings(resources.manifest);
        settings.resolveURL = resources.resolve;
        const model = await Live2DModel.from(settings);
        if (disposed || loadId !== modelLoadIdRef.current) {
          model.destroy({ children: true, texture: true, baseTexture: true });
          resources.dispose();
          return;
        }
        for (const texture of model.textures) texture.baseTexture.mipmap = PIXI.MIPMAP_MODES.OFF;
        modelRestStateRef.current = captureModelRestState(model.internalModel.coreModel as CubismRestModel);
        modelRef.current = model;
        if (resources.texturePlan.some((plan) => plan.source.width !== plan.render.width || plan.source.height !== plan.render.height)) {
          const source = Math.max(...resources.texturePlan.flatMap((plan) => [plan.source.width, plan.source.height]));
          const render = Math.max(...resources.texturePlan.flatMap((plan) => [plan.render.width, plan.render.height]));
          setTextureSummary(`${render.toLocaleString()}px rendering · ${source.toLocaleString()}px original`);
        }
        setModelStatus("ready");
        const bounds = model.getLocalBounds();
        resizeModel = () => {
          const stage = canvasRef.current?.parentElement?.getBoundingClientRect();
          if (!stage) return;
          const width = Math.max(1, Math.round(stage.width));
          const height = Math.max(1, Math.round(stage.height));
          app.renderer.resolution = isAppleMobile ? appleResolution : Math.min(window.devicePixelRatio || 1, 2);
          app.renderer.resize(width, height);
          const scale = Math.min((width * (width > height ? .43 : .88)) / bounds.width, ((height - Math.min(124, height * .15)) * .88) / bounds.height);
          model.scale.set(scale);
          // Models from different artists use different local origins. Pivot
          // from their measured bounds so none of them can land off-canvas.
          model.anchor.set(0, 0);
          model.pivot.set(bounds.x + bounds.width / 2, bounds.y + bounds.height);
          model.x = width / 2;
          model.y = height * .99;
        };
        app.stage.addChild(model);
        queueResize = () => {
          if (resizeFrame) cancelAnimationFrame(resizeFrame);
          if (resizeTimeout) window.clearTimeout(resizeTimeout);
          resizeFrame = requestAnimationFrame(() => requestAnimationFrame(resizeModel));
          resizeTimeout = window.setTimeout(resizeModel, 240);
        };
        handleOrientationChange = () => {
          queueResize();
        };
        queueResize();
        // If the artist did not supply a thumbnail, capture the rendered model.
        resizeModel();
        if (!activeModel.previewPath) {
          try {
            app.renderer.render(app.stage);
            // Read the rendered framebuffer: extracting the model as a render
            // texture resets its transform and makes Cubism previews too small.
            const snapshot = app.renderer.plugins.extract.canvas() as HTMLCanvasElement;
            const visibleBounds = model.getBounds();
            const pixelRatio = snapshot.width / app.renderer.screen.width;
            const left = Math.max(0, visibleBounds.x * pixelRatio);
            const top = Math.max(0, visibleBounds.y * pixelRatio);
            const width = Math.max(1, Math.min(snapshot.width - left, visibleBounds.width * pixelRatio));
            const height = Math.max(1, Math.min(snapshot.height - top, visibleBounds.height * pixelRatio));
            const thumbnail = document.createElement("canvas");
            const previewScale = Math.min(256 / width, 256 / height);
            thumbnail.width = Math.max(1, Math.round(width * previewScale));
            thumbnail.height = Math.max(1, Math.round(height * previewScale));
            thumbnail.getContext("2d")?.drawImage(snapshot, left, top, width, height, 0, 0, thumbnail.width, thumbnail.height);
            setModelPreview(thumbnail.toDataURL("image/png"));
          } catch { /* Preview failure does not prevent the model from loading. */ }
        }
        window.addEventListener("resize", queueResize);
        window.addEventListener("orientationchange", handleOrientationChange);
        window.visualViewport?.addEventListener("resize", queueResize);
      } catch (error) {
        if (!disposed) {
          console.error("Live2D failed to load", error);
          setModelStatus("error");
          setModelNotice(error instanceof Error ? error.message : "Could not render this model. Check that it is compatible with Cubism 4 and includes all assets.");
        }
        releaseResources?.();
      }
    })();
    return () => {
      disposed = true;
      textureAbort.abort();
      modelLoadIdRef.current += 1;
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
      if (resizeTimeout) window.clearTimeout(resizeTimeout);
      window.removeEventListener("resize", queueResize);
      window.removeEventListener("orientationchange", handleOrientationChange);
      window.visualViewport?.removeEventListener("resize", queueResize);
      const currentModel = modelRef.current;
      if (currentModel && app) {
        app.stage.removeChild(currentModel);
        currentModel.destroy({ children: true, texture: true, baseTexture: true });
      }
      modelRef.current = null;
      modelRestStateRef.current = null;
      releaseResources?.();
    };
  }, [preferencesReady, modelsReady, activeModel, activePackage, textureQuality]);

  useEffect(() => () => {
    pixiAppRef.current?.destroy(true, { children: true });
    pixiAppRef.current = null;
  }, []);

  useEffect(() => () => {
    micEnabledRef.current = false;
    stopRecording();
  }, []);

  async function loadMemory() {
    if (resettingRef.current) return;
    const generation = memoryGenerationRef.current;
    try {
      const response = await authFetch("/api/memory", { cache: "no-store" });
      const data = await response.json();
      if (generation !== memoryGenerationRef.current || resettingRef.current) return;
      if (Array.isArray(data.memories)) setMemories(data.memories);
      if (Array.isArray(data.messages)) setHistoryMessages(data.messages.map((item: { role: string; content: string; created_at?: string }) => ({ from: item.role === "user" ? "me" : "vivian", text: item.content, timestamp: item.created_at })));
      const next = normalizeCompanion(data.companion);
      if (next) setCompanion(next);
    } catch { /* Vivian stays usable while Supabase is unavailable. */ }
  }
  function normalizeCompanion(raw: unknown): CompanionState | null {
    if (!raw || typeof raw !== "object") return null;
    const item = raw as Record<string, unknown>;
    const mood = String(item.mood ?? "calm");
    return decayCompanionState({
      affinity: Number(item.affinity ?? 22),
      trust: Number(item.trust ?? 18),
      familiarity: Number(item.familiarity ?? 8),
      mood: normalizeMood(mood),
      moodIntensity: Number(item.moodIntensity ?? item.mood_intensity ?? 35),
      conversationSummary: String(item.conversationSummary ?? item.conversation_summary ?? ""),
      lastIdleAt: typeof item.lastIdleAt === "string" ? item.lastIdleAt : typeof item.last_idle_at === "string" ? item.last_idle_at : null,
      lastInteractionAt: typeof item.lastInteractionAt === "string" ? item.lastInteractionAt : typeof item.last_interaction_at === "string" ? item.last_interaction_at : null,
    });
  }
  function markActivity() {
    lastActivityRef.current = Date.now();
  }
  function lastIdleAt() {
    const fromState = companionRef.current.lastIdleAt ? Date.parse(companionRef.current.lastIdleAt) : 0;
    const fromStore = Number(window.localStorage.getItem(LAST_IDLE_KEY) ?? 0);
    return Math.max(fromState || 0, fromStore || 0);
  }
  async function maybeIdleGreeting() {
    if (resettingRef.current || idleBusyRef.current || sendingRef.current || speakingRef.current || recordingRef.current) return;
    if (!interactedRef.current || document.hidden) return;
    if (Date.now() - lastActivityRef.current < IDLE_AFTER_MS) return;
    if (Date.now() - lastIdleAt() < IDLE_COOLDOWN_MS) return;
    idleBusyRef.current = true;
    try {
      await sendMessage("", { idle: true });
      window.localStorage.setItem(LAST_IDLE_KEY, String(Date.now()));
    } finally {
      idleBusyRef.current = false;
      markActivity();
    }
  }
  function stopSpeech() {
    speakIdRef.current += 1;
    ttsAbortRef.current?.abort();
    ttsAbortRef.current = null;
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    speakingRef.current = false;
    stopLipSync();
    resetReaction();
  }
  function unlockAudio(): Promise<void> {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return Promise.resolve();
    audioContextRef.current ??= new AudioContextClass();
    if (audioPrimedRef.current && audioContextRef.current.state !== "suspended") return Promise.resolve();
    if (audioUnlockPromiseRef.current) return withTimeout(audioUnlockPromiseRef.current, AUDIO_UNLOCK_MS, undefined);
    const context = audioContextRef.current;
    const audio = audioRef.current ?? new Audio();
    audio.setAttribute("playsinline", "true");
    audio.preload = "auto";
    if (!audio.src) audio.src = SILENT_WAV;
    audio.muted = true;
    audioRef.current = audio;
    const unlock = (async () => {
      if (context.state === "suspended") await withTimeout(context.resume().then(() => undefined), 800, undefined);
      try {
        await withTimeout(audio.play().then(() => undefined), AUDIO_UNLOCK_MS, undefined);
        audio.pause();
        audio.currentTime = 0;
      } catch { /* Safari may reject empty or delayed unlock; chat must still continue. */ }
      audio.muted = false;
      audioPrimedRef.current = true;
    })();
    audioUnlockPromiseRef.current = unlock.finally(() => { audioUnlockPromiseRef.current = null; });
    return audioUnlockPromiseRef.current;
  }
  function setMouthOpen(value: number) {
    const coreModel = modelRef.current?.internalModel?.coreModel;
    if (!coreModel) return;
    const mouth = Math.max(0, Math.min(1, value));
    try {
      coreModel.setParameterValueById("ParamMouthOpenY", mouth);
      // Some Cubism models expose mouth shape separately. It is optional, so
      // keep this best-effort and preserve compatibility with older models.
      try { coreModel.setParameterValueById("ParamMouthForm", (mouth - .5) * .18); } catch { /* optional parameter */ }
    } catch (error) { console.warn("Live2D mouth parameter unavailable", error); }
  }
  function resetReaction() {
    const expressionManager = modelRef.current?.internalModel?.motionManager?.expressionManager;
    expressionActionRef.current += 1;
    setActiveExpression(null);
    try {
      if (expressionManager) {
        // Cubism's resetExpression only resets playback. Clear its selection and
        // pending load too, so the same expression can be enabled again.
        expressionManager.reserveExpressionIndex = -1;
        expressionManager.currentExpression = expressionManager.defaultExpression;
        expressionManager.resetExpression();
      }
    } catch (error) { console.warn("Live2D default expression unavailable", error); }
  }
  function stopLipSync() {
    if (lipSyncFrameRef.current !== null) cancelAnimationFrame(lipSyncFrameRef.current);
    lipSyncFrameRef.current = null;
    setMouthOpen(0);
  }
  function usesNativeAppleAudio() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }
  function startNativeLipSync(audio: HTMLAudioElement) {
    // Do not route an iOS media element through AudioContext. Safari can show
    // playback in Dynamic Island while that routed output is silent. Native
    // playback is reliable; this keeps a lightweight visual mouth movement.
    stopLipSync();
    let smoothed = 0;
    let previousTime = audio.currentTime;
    const update = () => {
      if (audio.paused || audio.ended) { setMouthOpen(0); lipSyncFrameRef.current = null; return; }
      // iOS Safari must stay on native playback, so there is no safe analyser
      // stream here. Use playback-time pulses with attack/release smoothing;
      // this avoids the old harsh, constant jaw oscillation while keeping the
      // mouth moving in sync with the spoken audio.
      const delta = Math.max(0, audio.currentTime - previousTime);
      previousTime = audio.currentTime;
      const pulse = .08 + (Math.sin(audio.currentTime * 17) * .5 + .5) * .34 + (Math.sin(audio.currentTime * 31) * .5 + .5) * .12;
      const target = delta > .12 ? 0 : Math.min(.62, pulse);
      smoothed += (target - smoothed) * (target > smoothed ? .42 : .2);
      setMouthOpen(smoothed);
      lipSyncFrameRef.current = requestAnimationFrame(update);
    };
    lipSyncFrameRef.current = requestAnimationFrame(update);
  }
  function startLipSync(audio: HTMLAudioElement) {
    if (usesNativeAppleAudio()) { startNativeLipSync(audio); return; }
    const context = audioContextRef.current;
    if (!context) return;
    stopLipSync();
    const analyser = analyserRef.current ?? context.createAnalyser();
    if (!analyserRef.current) {
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = .72;
      analyserRef.current = analyser;
    }
    if (!mediaSourceRef.current) {
      const source = context.createMediaElementSource(audio);
      source.connect(analyser);
      analyser.connect(context.destination);
      mediaSourceRef.current = source;
    }
    const samples = new Uint8Array(analyser.fftSize);
    const spectrum = new Uint8Array(analyser.frequencyBinCount);
    let smoothed = 0;
    const update = () => {
      if (audio.paused || audio.ended) { setMouthOpen(0); lipSyncFrameRef.current = null; return; }
      analyser.getByteTimeDomainData(samples);
      analyser.getByteFrequencyData(spectrum);
      let rms = 0;
      for (const sample of samples) { const delta = (sample - 128) / 128; rms += delta * delta; }
      rms = Math.sqrt(rms / samples.length);
      let energy = 0;
      for (let index = 1; index < spectrum.length; index += 1) energy += spectrum[index];
      const spectralLevel = spectrum.length > 1 ? energy / ((spectrum.length - 1) * 255) : 0;
      const level = Math.min(1, rms * 4.8 + spectralLevel * 1.8);
      const target = Math.max(0, Math.min(.9, Math.pow(level, .72)));
      smoothed += (target - smoothed) * (target > smoothed ? .5 : .18);
      setMouthOpen(smoothed);
      lipSyncFrameRef.current = requestAnimationFrame(update);
    };
    lipSyncFrameRef.current = requestAnimationFrame(update);
  }
  async function speak(text: string): Promise<boolean> {
    if (mutedRef.current) return false;
    const speakId = ++speakIdRef.current;
    const abort = new AbortController();
    ttsAbortRef.current = abort;
    speakingRef.current = true;
    const timeout = window.setTimeout(() => abort.abort(), TTS_TIMEOUT_MS);
    let objectUrl: string | null = null;
    try {
      await withTimeout(unlockAudio(), AUDIO_UNLOCK_MS, undefined);
      if (speakId !== speakIdRef.current) return false;
      const response = await authFetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, signal: abort.signal, body: JSON.stringify({ text, speed: speechSpeedRef.current, language: speechLanguageRef.current }) });
      if (speakId !== speakIdRef.current) return false;
      if (!response.ok) {
        const error = await response.json().catch(() => null) as { error?: string; code?: string } | null;
        throw new Error(error?.code ?? error?.error ?? "TTS failed");
      }
      const blob = await withTimeout(response.blob(), TTS_TIMEOUT_MS, null);
      if (speakId !== speakIdRef.current) return false;
      if (!blob || blob.size === 0) throw new Error("TTS failed");
      const audio = audioRef.current ?? new Audio();
      audioRef.current?.pause();
      if (audioRef.current?.src) audioRef.current.removeAttribute("src");
      objectUrl = URL.createObjectURL(blob);
      audio.src = objectUrl;
      audio.setAttribute("playsinline", "true");
      audio.muted = false;
      audio.defaultMuted = false;
      audio.volume = 1;
      audio.onended = () => {
        if (speakId === speakIdRef.current) speakingRef.current = false;
        stopLipSync();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
      audio.onerror = () => {
        if (speakId === speakIdRef.current) speakingRef.current = false;
        stopLipSync();
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
      audioRef.current = audio;
      const started = await withTimeout(audio.play().then(() => true), PLAYBACK_START_MS, false);
      if (speakId !== speakIdRef.current) return false;
      if (!started) {
        stopLipSync();
        throw new Error("TTS playback did not start");
      }
      // Start the animation only after playback begins. Starting it before
      // audio.play() lets the first frame see `paused` and permanently stop.
      startLipSync(audio);
      await new Promise<void>((resolve) => window.setTimeout(resolve, AUDIO_SYNC_SETTLE_MS));
      return speakId === speakIdRef.current;
    } catch (error) {
      if (speakId === speakIdRef.current) {
        speakingRef.current = false;
        if ((error as { name?: string }).name !== "AbortError") {
          resetReaction();
          console.error("TTS unavailable", error);
        }
      }
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      return false;
    } finally {
      window.clearTimeout(timeout);
      if (ttsAbortRef.current === abort) ttsAbortRef.current = null;
    }
  }
  async function sendMessage(overrideText?: string, options: { idle?: boolean; visionIdle?: boolean; image?: string } = {}) {
    const idle = Boolean(options.idle);
    const visionIdle = Boolean(options.visionIdle);
    const text = (overrideText ?? message).trim();
    let imageToSend = options.image ?? attachedImage;
    if (cameraActiveRef.current && !idle && !visionIdle) {
      const liveFrame = captureCurrentFrame();
      if (liveFrame) {
        imageToSend = liveFrame;
      }
    }
    if (sendingRef.current || resettingRef.current) return;
    if (!idle && !visionIdle && !text && !imageToSend) return;
    if (!idle && !visionIdle) {
      greetingGenerationRef.current += 1;
      greetingRequestRef.current?.abort();
      greetingTextRef.current = null;
    }
    if (!idle && !visionIdle && text && await handleExpressionCommand(text)) {
      setMessage("");
      setAttachedImage(null);
      markActivity();
      return;
    }
    if (speakingRef.current) stopSpeech();
    markActivity();
    if (!idle && !visionIdle) interactedRef.current = true;
    const displayText = text || (imageToSend ? "[ส่งรูปภาพ]" : "");
    const nextMessages = (idle || visionIdle) ? messagesRef.current : [...messagesRef.current.filter((item) => item.text !== GREETING_PENDING), { from: "me" as const, text: displayText }];
    if (!idle && !visionIdle) {
      setMessages(nextMessages);
      setMessage("");
      setAttachedImage(null);
    }
    setSending(true);
    sendingRef.current = true;
    const sceneGeneration = sceneLibrary.getGeneration();
    try {
      const response = await authFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abortAfter(CHAT_TIMEOUT_MS),
        body: JSON.stringify({
          mode: visionIdle ? "vision_idle" : idle ? "idle" : "chat",
          messages: nextMessages.filter((item) => item.text !== GREETING_PENDING).map((item) => ({ role: item.from === "me" ? "user" : "assistant", content: item.text })),
          image: imageToSend ?? undefined,
          character: selectedModel,
          customInstructions,
          language: speechLanguageRef.current,
        }),
      });
      const data = await withTimeout(response.json() as Promise<{ scene?: SceneDecision; text?: string; error?: string; code?: string; memories?: Memory[]; companion?: CompanionState }>, 5000, null);
      if (!response.ok || !data?.text) throw new Error(data?.code ?? data?.error ?? "Chat request failed");
      sceneLibrary.applyChatScene(data.scene, sceneGeneration);
      const reply = data.text;
      setErrorNotice(null);
      // Do not reveal the reply bubble before Fish Audio has started. This
      // keeps the visible text and spoken response arriving together.
      if (!muted) await speak(reply);
      setMessages((current) => [...current, { from: "vivian", text: reply, timestamp: new Date().toISOString() }]);
      const nextCompanion = normalizeCompanion(data.companion);
      if (nextCompanion) setCompanion(nextCompanion);
      if (data.memories?.length) setMemories(data.memories.filter((item: Memory) => typeof item.id === "number"));
      setSending(false);
      sendingRef.current = false;
      void playReaction(reply, text, idle || visionIdle);
      void loadMemory();
    } catch (error) {
      console.error("Vivian response unavailable", error);
      resetReaction();
      if (!idle && !visionIdle) {
        const message = error instanceof Error && error.message.includes("RATE_LIMITED") ? "ส่งถี่เกินไปค่ะ รอสักครู่นะคะ"
          : error instanceof Error && error.message === "SEARCH_UNAVAILABLE" ? "ตอนนี้ค้นเว็บไม่ได้ค่ะ แต่ยังคุยเรื่องทั่วไปได้นะคะ"
          : error instanceof Error && error.message === "CHAT_NOT_CONFIGURED" ? "ตอนนี้ระบบแชตยังไม่พร้อมใช้งานค่ะ"
          : "ตอนนี้เชื่อมต่อไม่สำเร็จ ลองใหม่อีกครั้งนะคะ";
        setErrorNotice(message);
        setMessages((current) => [...current, { from: "vivian", text: message }]);
      }
    } finally {
      setSending(false);
      sendingRef.current = false;
    }
  }
  function moodExpression(mood: Mood, intensity: number) {
    const map: Record<Mood, string> = { calm: "#", warm: intensity >= 70 ? "M lianhong" : "M miyan", playful: intensity >= 70 ? "M xingxing" : "M xingxing2", shy: "M love", tired: "S chabei", melancholy: "M QAQ", tsundere: intensity >= 70 ? "M lianhong" : "M nu" };
    return map[mood];
  }
  function situationExpression(text: string, mood: Mood, intensity: number, idle: boolean) {
    // Miss has 15 authored expressions. Match them to the conversation
    // context deterministically so every expression has a meaningful use.
    const rules: Array<[string, RegExp]> = [
      ["X shetou", /จุ๊บ|จูบ|แกล้ง|หยอก|ล้อเล่น|ทะเล้น|kiss|tease|tongue/i],
      ["S shouji", /โทรศัพท์|โทรหา|สายโทร|ข้อความ|แจ้งเตือน|notification|phone|call|message|text/i],
      ["S chabei", /ชา|กาแฟ|ดื่ม|จิบ|พัก|เหนื่อย|ง่วง|tea|coffee|drink|rest|tired|sleepy/i],
      ["T faxing", /ผม|ทรงผม|แต่งตัว|แต่งหน้า|สวย|ดูดี|แฟชั่น|hair|hairstyle|makeup|beautiful|pretty|style/i],
      ["M QAQ", /เศร้า|เสียใจ|ร้องไห้|เหงา|ขอโทษ|sad|sorry|cry|lonely/i],
      ["M nu", /โกรธ|โมโห|หงุดหงิด|รำคาญ|ไม่พอใจ|angry|mad|annoyed|upset/i],
      ["M wenhao ", /ตกใจ|ว้าว|จริงเหรอ|หา|ไม่น่าเชื่อ|surprise|wow|really|shocked/i],
      ["M ##", /อะไรนะ|ห๊ะ|เอ๊ะ|งง|ไม่เข้าใจ|ทำไม|what|huh|confused|don't understand|why/i],
      ["M love", /เขิน|อาย|น่ารัก|ชม|หน้าแดง|cute|shy|blush|compliment/i],
      ["M lianhong", /รัก|ชอบ|คิดถึง|กอด|ห่วง|love|like|miss you|hug|care/i],
      ["M xingxing2", /ขำ|ตลก|หัวเราะ|มุก|ฮา|haha|lol|funny|joke|laugh/i],
      ["M xingxing", /ดีใจ|ตื่นเต้น|เยี่ยม|สุดยอด|ฉลอง|ดาว|happy|excited|great|awesome|celebrate|star/i],
      ["M ###", /ตา|มอง|กระพริบ|หลับตา|ดูนี่|eyes|look|blink|watch/i],
      ["M miyan", /ยิ้ม|สวัสดี|ทักทาย|ขอบคุณ|สุขสันต์|happy|smile|hello|greeting|thank/i],
    ];
    const matched = rules.find(([, pattern]) => pattern.test(text))?.[0];
    if (matched) return matched;
    if (idle && mood === "tired") return "S chabei";
    return moodExpression(mood, intensity);
  }
  async function handleExpressionCommand(text: string) {
    const match = text.match(/^\/(?:expression|exp)(?:\s+(.+))?$/i);
    if (!match) return false;
    const argument = match[1]?.trim() ?? "";
    const expressions = (activeModel?.expressions ?? []);
    if (argument.toLowerCase() === "list") {
      setMessages((current) => [...current, { from: "me", text }, { from: "vivian", text: `Expression ที่ใช้ได้: ${expressions.join(", ")}` }]);
      return true;
    }
    if (!argument || argument.toLowerCase() === "default" || argument.toLowerCase() === "reset") {
      resetReaction();
      setMessages((current) => [...current, { from: "me", text }, { from: "vivian", text: "กลับไปใช้ expression default แล้วค่ะ" }]);
      return true;
    }
    const expression = expressions.find((item) => item.trim().toLowerCase() === argument.toLowerCase());
    if (!expression) {
      setMessages((current) => [...current, { from: "me", text }, { from: "vivian", text: "ไม่พบ expression นี้ค่ะ ลองใช้ /expression list เพื่อดูรายการ" }]);
      return true;
    }
    try {
      if (!modelRef.current) throw new Error("Live2D model is not ready");
      await modelRef.current.expression(expression);
      setActiveExpression(expression);
      setMessages((current) => [...current, { from: "me", text }, { from: "vivian", text: `เปลี่ยนเป็น expression ${expression.trim()} แล้วค่ะ` }]);
    } catch (error) {
      console.warn("Manual Live2D expression unavailable", error);
      resetReaction();
      setMessages((current) => [...current, { from: "me", text }, { from: "vivian", text: "ยังเปลี่ยน expression ไม่ได้ค่ะ โมเดลกำลังโหลดอยู่" }]);
    }
    return true;
  }
  async function playReaction(reply: string, userText: string, idle = false) {
    const model = modelRef.current;
    if (!model) return;
    const combined = `${reply} ${userText}`;
    const { mood, moodIntensity: intensity } = companionRef.current;
    const supportedExpressions = activeModel?.expressions ?? [];
    const authoredExpression = situationExpression(combined, mood, intensity, idle);
    const emotionNames: Record<Mood, RegExp> = {
      calm: /neutral|normal|default|calm|平常|通常|ปกติ/i,
      warm: /happy|smile|joy|warm|笑|开心|ยิ้ม/i,
      playful: /happy|smile|excited|laugh|笑|开心|ดีใจ/i,
      shy: /shy|blush|embarrass|照れ|害羞|脸红|เขิน/i,
      tired: /tired|sleep|眠|困|ง่วง/i,
      melancholy: /sad|cry|tear|悲|哭|เศร้า/i,
      tsundere: intensity >= 70 ? /shy|blush|embarrass|照れ|害羞|脸红|เขิน/i : /angry|mad|pout|怒|生气|งอน/i,
    };
    const expression = supportedExpressions.find((name) => name.trim() === authoredExpression.trim())
      ?? supportedExpressions.find((name) => emotionNames[mood].test(name));
    try {
      if (expression) { await model.expression(expression); setActiveExpression(expression); }
      else resetReaction();
      const definitions = model.internalModel?.motionManager?.definitions ?? {};
      // Use authored groups when available and keep unknown models at idle.
      const motionByExpression: Record<string, string[]> = {
        "M love": ["Shy", "Idle"], "M QAQ": ["Sad", "Idle"], "M nu": ["Angry", "Idle"],
        "M wenhao ": ["Surprise", "Idle"], "M ##": ["Thinking", "Idle"], "M xingxing": ["Excited", "Idle"],
        "M xingxing2": ["Laugh", "Idle"], "S chabei": ["Tea", "Idle"], "S shouji": ["Phone", "Idle"],
        "T faxing": ["Hair", "Idle"], "X shetou": ["Tease", "Idle"], "M ###": ["Look", "Idle"],
        "M miyan": ["Happy", "Idle"], "M lianhong": ["Warm", "Idle"], "#": ["Idle"],
      };
      const motionName = (motionByExpression[authoredExpression] ?? ["Idle"]).find((name) => definitions[name]?.length);
      if (motionName) await model.motion(motionName, 0, intensity >= 70 ? 3 : 2);
    } catch (error) {
      resetReaction();
      console.warn("Live2D reaction unavailable; keeping neutral state", error);
    }
  }
  async function startRecording() {
    if (resettingRef.current || recording || recorderRef.current) return;
    const generation = memoryGenerationRef.current;
    if (speakingRef.current) stopSpeech();
    markActivity();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      if (generation !== memoryGenerationRef.current) { stream.getTracks().forEach((track) => track.stop()); return; }
      const chunks: BlobPart[] = [];
      const preferredMimeTypes = ["audio/mp4", "audio/webm;codecs=opus", "audio/webm"];
      const mimeType = preferredMimeTypes.find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 128000 });
      recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
      recorder.onstop = async () => {
        if (generation !== memoryGenerationRef.current) { recorderRef.current = null; streamRef.current = null; return; }
        const durationMs = Date.now() - recordingStartedAtRef.current;
        const actualMimeType = recorder.mimeType || mimeType || "audio/webm";
        const extension = actualMimeType.includes("mp4") ? "m4a" : "webm";
        if (durationMs < MIN_RECORDING_MS || !chunks.length) {
          setSttPreview("ยังไม่มีเสียงที่ชัดพอค่ะ");
          window.setTimeout(() => setSttPreview(null), 2500);
          recorderRef.current = null;
          streamRef.current = null;
          return;
        }
        const form = new FormData();
        form.append("file", new Blob(chunks, { type: actualMimeType }), `vivian-recording.${extension}`);
        try {
          form.append("language", speechLanguageRef.current);
          const response = await authFetch("/api/stt", { method: "POST", body: form, signal: abortAfter(STT_TIMEOUT_MS) });
          const data = await response.json() as { text?: string; error?: string };
          if (generation !== memoryGenerationRef.current) return;
          if (!response.ok) throw new Error(data.error ?? "STT failed");
          if (data.text?.trim()) {
            setSttPreview(data.text);
            void sendMessage(data.text);
            window.setTimeout(() => setSttPreview(null), 5000);
          } else throw new Error("STT returned no speech");
        } catch (error) {
          console.warn("STT unavailable", error);
          setSttPreview("ฟังไม่ชัด ลองพูดใหม่อีกครั้งนะคะ");
          window.setTimeout(() => setSttPreview(null), 3000);
        } finally {
          recorderRef.current = null;
          streamRef.current = null;
          // Do not restart the mic while Vivian is speaking. startRecording
          // intentionally stops active speech for a manual barge-in, so an
          // automatic STT restart must wait until the current TTS is ended.
          const resumeListening = () => {
            if (!micEnabledRef.current || recordingRef.current) return;
            if (speakingRef.current || sendingRef.current) {
              window.setTimeout(resumeListening, 250);
              return;
            }
            void startRecording();
          };
          window.setTimeout(resumeListening, 250);
        }
      };
      recorder.start();
      recorderRef.current = recorder;
      streamRef.current = stream;
      recordingStartedAtRef.current = Date.now();
      recordingRef.current = true;
      setRecording(true);
      // Keep the recorder open and split speech into utterances using local
      // voice activity detection. Only the resulting clip is sent to STT.
      const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        const voiceContext = new AudioContextClass();
        const analyser = voiceContext.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = .75;
        voiceSourceRef.current = voiceContext.createMediaStreamSource(stream);
        voiceSourceRef.current.connect(analyser);
        voiceAnalyserRef.current = analyser;
        const samples = new Uint8Array(analyser.fftSize);
        let heardSpeech = false;
        let speechStartedAt = 0;
        let quietSince = 0;
        let noiseFloor = 0;
        const noiseCalibrationEndsAt = Date.now() + 700;
        const monitor = () => {
          if (!recordingRef.current || recorderRef.current !== recorder) return;
          analyser.getByteTimeDomainData(samples);
          let sum = 0;
          for (const sample of samples) { const delta = sample - 128; sum += delta * delta; }
          const rms = Math.sqrt(sum / samples.length) / 128;
          if (Date.now() < noiseCalibrationEndsAt) {
            noiseFloor = noiseFloor ? noiseFloor * .88 + rms * .12 : rms;
            voiceMonitorRef.current = requestAnimationFrame(monitor);
            return;
          }
          // Adapt to fans, music and room noise. The floor is allowed to rise
          // slowly, but a real voice must still clear a meaningful margin.
          noiseFloor = noiseFloor * .995 + rms * .005;
          const speechThreshold = Math.max(.065, Math.min(.18, noiseFloor * 2.8 + .018));
          if (rms > speechThreshold) {
            speechStartedAt ||= Date.now();
            if (Date.now() - speechStartedAt >= 380) heardSpeech = true;
            quietSince = 0;
          }
          else if (heardSpeech) {
            quietSince ||= Date.now();
            if (Date.now() - quietSince > 900) { stopRecording(); return; }
          } else if (Date.now() - speechStartedAt > 500) speechStartedAt = 0;
          voiceMonitorRef.current = requestAnimationFrame(monitor);
        };
        voiceMonitorRef.current = requestAnimationFrame(monitor);
      }
    } catch {
      resetReaction();
      setMessages((current) => [...current, { from: "vivian", text: "ยังไม่ได้รับสิทธิ์ใช้ไมโครโฟนค่ะ" }]);
    }
  }
  function stopRecording() {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    if (voiceMonitorRef.current !== null) cancelAnimationFrame(voiceMonitorRef.current);
    voiceMonitorRef.current = null;
    voiceSourceRef.current?.disconnect();
    voiceSourceRef.current = null;
    voiceAnalyserRef.current = null;
    recordingRef.current = false;
    setRecording(false);
  }
  function toggleRecording() {
    if (micEnabledRef.current) {
      micEnabledRef.current = false;
      stopRecording();
    } else {
      micEnabledRef.current = true;
      void startRecording();
    }
  }

  function captureCurrentFrame(): string | null {
    const video = videoRef.current;
    if (!video) return null;
    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 480;
    if (!vw || !vh) return null;

    try {
      const canvas = document.createElement("canvas");
      const maxDim = 800;
      let width = vw;
      let height = vh;
      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0, width, height);
      return canvas.toDataURL("image/jpeg", 0.75);
    } catch (err) {
      console.warn("captureCurrentFrame error", err);
      return null;
    }
  }

  useEffect(() => {
    const video = videoRef.current;
    if (cameraActive && video && videoStreamRef.current) {
      if (video.srcObject !== videoStreamRef.current) {
        video.srcObject = videoStreamRef.current;
      }
      video.muted = true;
      video.play().catch((err) => console.warn("Camera play failed", err));
    }
  }, [cameraActive]);

  async function startCamera(facing: "user" | "environment" = cameraFacing) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: facing },
        audio: false,
      });
      videoStreamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        video.muted = true;
        await video.play().catch((err) => console.warn("Initial camera play failed", err));
      }
      setCameraFacing(facing);
      setCameraActive(true);
      cameraActiveRef.current = true;
      lastVisionTriggerRef.current = Date.now();
    } catch (err) {
      console.error("Camera access failed", err);
      setErrorNotice("ไม่สามารถเปิดกล้องได้ กรุณาอนุญาตการเข้าถึงกล้องนะคะ");
    }
  }

  function stopCamera() {
    videoStreamRef.current?.getTracks().forEach((track) => track.stop());
    videoStreamRef.current = null;
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraActive(false);
    cameraActiveRef.current = false;
    if (visionTimerRef.current) window.clearTimeout(visionTimerRef.current);
    visionTimerRef.current = null;
  }

  async function toggleCamera() {
    if (cameraActive) {
      stopCamera();
    } else {
      await startCamera();
    }
  }

  async function switchCamera() {
    const nextFacing = cameraFacing === "user" ? "environment" : "user";
    // Stop current tracks before switching
    videoStreamRef.current?.getTracks().forEach((track) => track.stop());
    videoStreamRef.current = null;
    await startCamera(nextFacing);
  }

  function handleImageUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErrorNotice("กรุณาเลือกไฟล์รูปภาพนะคะ");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const rawData = reader.result as string;
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const maxDim = 800;
        let width = img.width;
        let height = img.height;
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const compressed = canvas.toDataURL("image/jpeg", 0.75);
          setAttachedImage(compressed);
        } else {
          setAttachedImage(rawData);
        }
      };
      img.onerror = () => {
        setAttachedImage(rawData);
      };
      img.src = rawData;
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  useEffect(() => {
    if (!cameraActive) {
      if (visionTimerRef.current) window.clearTimeout(visionTimerRef.current);
      visionTimerRef.current = null;
      return;
    }
    let isMounted = true;
    function scheduleNextCapture() {
      const delay = Math.floor(Math.random() * (VISION_MAX_INTERVAL_MS - VISION_MIN_INTERVAL_MS + 1)) + VISION_MIN_INTERVAL_MS;
      visionTimerRef.current = window.setTimeout(async () => {
        if (!isMounted || !cameraActiveRef.current) return;
        const now = Date.now();
        const timeSinceLast = now - lastVisionTriggerRef.current;
        if (
          timeSinceLast >= VISION_COOLDOWN_MS &&
          !sendingRef.current &&
          !speakingRef.current &&
          !recordingRef.current &&
          !message.trim()
        ) {
          const frame = captureCurrentFrame();
          if (frame) {
            lastVisionTriggerRef.current = Date.now();
            await sendMessage("", { visionIdle: true, image: frame });
          }
        }
        if (isMounted && cameraActiveRef.current) {
          scheduleNextCapture();
        }
      }, delay);
    }
    scheduleNextCapture();
    return () => {
      isMounted = false;
      if (visionTimerRef.current) window.clearTimeout(visionTimerRef.current);
      visionTimerRef.current = null;
    };
  }, [cameraActive, message]);

  async function saveMemory(memory: Memory) {
    const response = await authFetch("/api/memory", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: memory.id, memory: memoryDraft, category: memory.category, importance: memory.importance }) });
    if (!response.ok) return setErrorNotice("บันทึกความจำไม่สำเร็จค่ะ");
    const data = await response.json() as { memory?: Memory };
    if (data.memory) setMemories((current) => current.map((item) => item.id === memory.id ? data.memory! : item));
    setEditingMemoryId(null);
  }

  async function resetVivian(): Promise<void> {
    if (sendingRef.current || resettingRef.current) return;
    setResetConfirming(false);
    resettingRef.current = true;
    memoryGenerationRef.current += 1;
    setResetting(true);
    setResetNotice(null);
    greetingGenerationRef.current += 1;
    greetingRequestRef.current?.abort();
    greetingTextRef.current = null;
    stopSpeech();
    micEnabledRef.current = false;
    stopRecording();
    stopCamera();
    try {
      const response = await authFetch("/api/memory", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope: "all" }) });
      if (!response.ok) throw new Error("Reset failed");
      const data = await response.json() as { ok?: boolean };
      if (data.ok !== true) throw new Error("Reset unconfirmed");
      for (const key of [CONVERSATIONS_KEY, "vivian-active-conversation", "vivian-checkin-date", "vivian-streak", LAST_IDLE_KEY, "vivian-custom-instructions"]) window.localStorage.removeItem(key);
      const id = crypto.randomUUID();
      window.localStorage.setItem("vivian-active-conversation", id);
      setActiveConversationId(id);
      setConversations([]);
      initialGreeting.current = { from: "vivian", text: "...ไง เริ่มคุยกันใหม่ได้เลยนะ" };
      setMessages([]);
      setHistoryMessages([]);
      setMemories([]);
      setCompanion(defaultCompanionState());
      setCustomInstructions("");
      setStreak(0);
      setMessage("");
      setAttachedImage(null);
      setSttPreview(null);
      setEditingMemoryId(null);
      setMemoryDraft("");
      setConversationSearch("");
      setErrorNotice(null);
      markActivity();
      interactedRef.current = false;
      setResetNotice("รีเซ็ตแล้ว เริ่มคุยกันใหม่ได้เลยนะ");
    } catch {
      setResetNotice("รีเซ็ตไม่สำเร็จทั้งหมด ลองอีกครั้งนะ แชตบนอุปกรณ์นี้ยังไม่ได้ล้าง");
    } finally {
      resettingRef.current = false;
      setResetting(false);
    }
  }

  function openPanel(next: Panel) { setPanel(next); setSidebarOpen(true); }
  function selectConversation(conversation: Conversation) {
    if (sending || resettingRef.current) return;
    setErrorNotice(null);
    greetingGenerationRef.current += 1;
    greetingRequestRef.current?.abort();
    greetingTextRef.current = null;
    setActiveConversationId(conversation.id);
    window.localStorage.setItem("vivian-active-conversation", conversation.id);
    setMessages(conversation.messages);
    setPanel(null);
    setSidebarOpen(false);
  }
  function newConversation() {
    if (sending || resettingRef.current) return;
    setErrorNotice(null);
    greetingGenerationRef.current += 1;
    greetingRequestRef.current?.abort();
    greetingTextRef.current = null;
    greetingSpokenRef.current = false;
    const id = crypto.randomUUID();
    setActiveConversationId(id);
    window.localStorage.setItem("vivian-active-conversation", id);
    setMessages([{ from: "vivian", text: GREETING_PENDING }]);
    setGreetingTrigger((value) => value + 1);
    setPanel(null);
    setSidebarOpen(false);
  }
  const navigation: Array<{ key: Panel; label: string; icon: IconName }> = [
    { key: "conversations", label: "Conversations", icon: "message" },
    { key: "memories", label: "Memories", icon: "memory" },
    { key: "character", label: "Character", icon: "wardrobe" },
    { key: "scenes", label: "Scenes", icon: "scene" },
    { key: "voice", label: "Voice", icon: "sound" },
    { key: "status", label: "Status", icon: "status" },
    { key: "settings", label: "Settings", icon: "config" },
  ];

  return <main className="companion-shell">
    <section className={`companion-stage ${MODEL_CONFIG[selectedModel].background} ${!sending && !recording ? "is-idle" : ""}`} aria-label="Vivian companion">
      <SceneBackground source={sceneLibrary.scenes.find((scene) => scene.id === activeCustomSceneId)?.imageUrl ?? BACKGROUNDS[selectedPreset]} />
      <canvas className="live2d-canvas" ref={canvasRef} />
      <button className="floating-menu-trigger" type="button" onClick={() => { setPanel(null); setSidebarOpen((value) => !value); }} aria-label={sidebarOpen ? "Close Vivian menu" : "Open Vivian menu"} aria-expanded={sidebarOpen}><Icon name={sidebarOpen ? "close" : "config"} size={21}/></button>
      <header className="companion-brand"><span className="brand-mark" aria-hidden="true"/><span>Vivian</span></header>
      <div className="scene-quick-controls">
        <button type="button" onClick={() => selectPresetScene(selectedPreset === "day" ? "night" : "day")} aria-label="Toggle day and night scene" title="Day / Night"><Icon name={selectedPreset === "day" ? "moon" : "sun"} size={20}/></button>
      </div>
      <div className="camera-pip" style={{ display: cameraActive ? "flex" : "none" }} aria-label="Live Camera Vision">
        <div className="camera-pip-header">
          <div className="live-badge">
            <span className="live-dot" aria-hidden="true" />
            <span>{cameraFacing === "environment" ? "REAR CAM" : "LIVE VISION"}</span>
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            <button type="button" onClick={switchCamera} aria-label="สลับกล้อง" title="สลับกล้องหน้า/หลัง">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 7H4m0 0l4-4M4 7l4 4M4 17h16m0 0-4 4m4-4-4-4"/>
              </svg>
            </button>
            <button type="button" onClick={stopCamera} aria-label="ปิดกล้อง">×</button>
          </div>
        </div>
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="camera-video-feed"
          style={{ transform: cameraFacing === "environment" ? "none" : "scaleX(-1)" }}
          onLoadedMetadata={(e) => {
            e.currentTarget.play().catch((err) => console.warn("Video play on metadata blocked", err));
          }}
        />
      </div>
      <div className="speech-stack">
        {sttPreview && <div className="speech-preview"><small>You said</small>{sttPreview}</div>}
        <output className={`vivian-speech ${sending ? "is-thinking" : ""}`} aria-live="polite">
          {sending
            ? <span className="speech-transition" key="thinking"><span>Vivian กำลังคิด</span><span className="thinking-dots" aria-hidden="true"><i/><i/><i/></span></span>
            : <span className="speech-transition" key={lastVivianMessage}>{lastVivianMessage}</span>}
        </output>
      </div>
      {errorNotice && <button className="error-notice" type="button" onClick={() => setErrorNotice(null)}>{errorNotice} ×</button>}
      {attachedImage && (
        <div className="attachment-preview" aria-label="รูปภาพที่แนบ">
          <img src={attachedImage} alt="Attachment preview" />
          <span>แนบรูปภาพแล้ว</span>
          <button type="button" onClick={() => setAttachedImage(null)} aria-label="ลบรูปภาพ">×</button>
        </div>
      )}
      <form className="companion-input" onSubmit={(event) => { event.preventDefault(); void sendMessage(); }}>
        <button className={`circle-control ${recording ? "is-recording" : "is-muted"}`} type="button" onClick={toggleRecording} aria-pressed={recording} aria-label={recording ? "Mute microphone" : "Microphone muted, click to unmute"}><Icon name={recording ? "mic" : "micOff"}/></button>
        <button className={`circle-control ${cameraActive ? "is-active is-camera-active" : ""}`} type="button" onClick={toggleCamera} aria-pressed={cameraActive} aria-label={cameraActive ? "ปิดกล้อง Live" : "เปิดกล้อง Live"}><Icon name="video"/></button>
        <button className={`circle-control ${attachedImage ? "is-active" : ""}`} type="button" onClick={() => fileInputRef.current?.click()} aria-label="แนบรูปภาพ"><Icon name="clip"/></button>
        <input ref={fileInputRef} type="file" accept="image/*" style={{ display: "none" }} onChange={handleImageUpload} tabIndex={-1} />
        <input value={message} onChange={(event) => setMessage(event.target.value)} placeholder={recording ? "กำลังฟัง... กดไมค์เพื่อ Mute" : cameraActive ? "กล้อง Live กำลังทำงาน... พิมพ์คุยได้" : "Ask Vivian"} aria-label="ข้อความถึง Vivian" />
        <button className="send-text" type="submit" disabled={sending || (!message.trim() && !attachedImage)} aria-label="ส่งข้อความ"><Icon name="send" size={22}/></button>
        <button className="text-send" type="button" onClick={() => openPanel("conversations")}><Icon name="message" size={23}/><span>Chat</span></button>
      </form>
    </section>
    <div className={`floating-overlay ${sidebarOpen ? "is-visible" : ""}`} aria-hidden={!sidebarOpen}>
      <button className="floating-scrim" type="button" tabIndex={sidebarOpen ? 0 : -1} onClick={() => { setPanel(null); setSidebarOpen(false); }} aria-label="Close sidebar" />
      <div className="floating-workspace">
        <nav className="floating-sidebar" aria-label="Vivian navigation" inert={!sidebarOpen}>
          <div className="floating-sidebar-head"><span className="brand-mark" aria-hidden="true"/> Vivian <button type="button" onClick={() => { setPanel(null); setSidebarOpen(false); }} aria-label="Close sidebar"><Icon name="close" size={18}/></button></div>
          <button type="button" className="floating-new-chat" onClick={newConversation}><Icon name="plus" size={17}/> New Chat</button>
          {navigation.map((item) => <button key={item.key} type="button" className={`floating-nav-item ${panel === item.key ? "is-selected" : ""}`} onClick={() => openPanel(item.key)}><Icon name={item.icon} size={18}/>{item.label}</button>)}
        </nav>
        {panel && <section className="floating-panel" role="dialog" aria-modal="true" aria-label={navigation.find((item) => item.key === panel)?.label}>
          <div className="floating-panel-head"><div><small>VIVIAN / {panel.toUpperCase()}</small><h2>{navigation.find((item) => item.key === panel)?.label}</h2></div><button type="button" onClick={() => setPanel(null)} aria-label="Close panel"><Icon name="close" size={18}/></button></div>
          <div className="floating-panel-body">
            {panel === "conversations" && <>
              <label className="floating-search"><Icon name="search" size={17}/><input value={conversationSearch} onChange={(event) => setConversationSearch(event.target.value)} placeholder="Search conversations" /></label>
              <div className="conversation-list">{conversations.filter((item) => item.title.toLowerCase().includes(conversationSearch.toLowerCase()) || item.messages.some((entry) => entry.text.toLowerCase().includes(conversationSearch.toLowerCase()))).sort((a, b) => b.updatedAt - a.updatedAt).map((conversation) => <button key={conversation.id} type="button" className={conversation.id === activeConversationId ? "is-selected" : ""} onClick={() => selectConversation(conversation)}><span className="conversation-avatar">V</span><span><strong>{conversation.title}</strong><small>{conversation.messages.at(-1)?.text ?? "Start chatting with Vivian"}</small></span><time>{new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(conversation.updatedAt)}</time></button>)}</div>
              {historyMessages.length > 0 && <details className="cloud-history"><summary>Earlier messages · {historyMessages.length}</summary><div className="chat-history">{historyMessages.map((item, index) => <div className={`chat-message ${item.from}`} key={`${item.timestamp ?? "past"}-${index}`}><small>{item.from === "me" ? "You" : "Vivian"}</small><p>{item.text}</p></div>)}</div></details>}
              {!conversations.length && <p className="floating-empty">Your conversations will appear here.</p>}
              <p className="floating-note">Recent conversations are saved on this device. Vivian’s existing cloud memory continues to work across chats.</p>
            </>}
            {panel === "memories" && <>
              <div className="bond-panel"><p><strong>Daily check-in</strong> {streak} days together</p><p><strong>Mood</strong>{moodLabel(companion.mood)}</p>{[["Affinity", companion.affinity], ["Trust", companion.trust], ["Familiarity", companion.familiarity]].map(([label, value]) => <div key={String(label)}><span>{label}</span><i><b style={{ width: `${value}%` }}/></i><em>{value}</em></div>)}</div>
              <div className="memory-list">{memories.length ? memories.map((memory) => <article key={memory.id}><Icon name="memory" size={18}/>{editingMemoryId === memory.id ? <div className="memory-edit"><textarea value={memoryDraft} maxLength={500} onChange={(event) => setMemoryDraft(event.target.value)}/><div><button type="button" onClick={() => void saveMemory(memory)}>Save</button><button type="button" onClick={() => setEditingMemoryId(null)}>Cancel</button></div></div> : <><p><strong>{memory.category}</strong>{memory.memory}</p><button type="button" className="memory-edit-button" onClick={() => { setEditingMemoryId(memory.id); setMemoryDraft(memory.memory); }}>Edit</button></>}</article>) : <p className="floating-empty">Vivian will remember the important things you share.</p>}</div>
            </>}
            {panel === "character" && <>
              <div className="floating-tabs">{(["outfit", "expression", "pose"] as const).map((tab) => <button key={tab} type="button" className={characterTab === tab ? "is-selected" : ""} onClick={() => setCharacterTab(tab)}>{tab === "outfit" ? "Models" : tab}</button>)}</div>
              {characterTab === "outfit" && <>
                <div className="character-preview">
                  {modelPreview ? <img className="model-preview-image" src={modelPreview} alt={`${activeModel?.name ?? "Model"} preview`} /> : <span className="character-preview-mark">V</span>}
                  <strong>{activeModel?.name ?? "Your character awaits"}</strong>
                  <small>{modelStatus === "loading" ? "Loading model…" : modelStatus === "ready" ? `${activeModel?.expressions.length ?? 0} expressions · ${activeModel?.motions.length ?? 0} motions` : "Import your Live2D model"}</small>
                </div>
                {modelPackages.length > 0 && <label className="model-select-label">Model<select value={activeModelId ?? ""} disabled={modelImporting} onChange={(event) => { void chooseModel(event.target.value); }}>{modelPackages.flatMap((pack) => pack.models.map((model) => <option key={model.id} value={model.id}>{model.name}{cloudLibrary?.models.some((entry) => entry.id === pack.id) ? " · Cloud" : " · This device"}</option>))}</select></label>}
                {activeModel && <label className="model-select-label">Texture quality<select value={textureQuality} onChange={(event) => { setModelNotice(null); setTextureQuality(event.target.value as "auto" | "original"); }}><option value="auto">Auto · fit this device</option><option value="original">Original textures</option></select></label>}
                {textureSummary && <p className="floating-note">{textureSummary}. Original files stay unchanged.</p>}
                <div className="model-import-actions">
                  <button className="floating-option model-import-primary" type="button" disabled={modelImporting || !modelsReady} onClick={() => modelZipRef.current?.click()}><Icon name="plus" size={16} />{modelImporting ? "Importing…" : "Import model ZIP"}</button>
                  <button className="floating-option" type="button" disabled={modelImporting || !modelsReady} onClick={() => modelFolderRef.current?.click()}>Choose folder</button>
                </div>
                <input ref={modelZipRef} hidden type="file" accept=".zip" onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void importModels(files); }} />
                <input ref={modelFolderRef} hidden type="file" multiple {...{ webkitdirectory: "", directory: "" }} onChange={(event) => { const files = Array.from(event.target.files ?? []); event.target.value = ""; void importModels(files); }} />
                <p className="floating-note">{cloudLibrary ? "New imports are saved privately to cloud and cached on this device." : "Models are saved on this device while cloud sync is unavailable."} Include the .model3.json, .moc3, textures and animation files. Up to 512 MiB per package.</p>
                {cloudLibrary && <p className="floating-note">Live2D storage: {(cloudLibrary.usage.live2d.used / 1e9).toFixed(2)} / 8 GB · Other files: {(cloudLibrary.usage.other.used / 1e9).toFixed(2)} / 2 GB. Uploads in progress count toward these limits.</p>}
                {activePackage && cloudLibrary && !cloudLibrary.models.some((model) => model.id === activePackage.id) && <button className="floating-option" type="button" disabled={modelImporting} onClick={() => { void saveActiveModelToCloud(); }}>Save this model to cloud</button>}
                {activePackage && <button className="floating-option model-remove" type="button" disabled={modelImporting} onClick={() => { void removeActiveModel(); }}>{cloudLibrary?.models.some((model) => model.id === activePackage.id) ? "Delete this package from cloud and this device" : "Remove this package from browser"}</button>}
              </>}
              {characterTab === "expression" && <>
                <button type="button" className="floating-option" disabled={modelStatus !== "ready"} onClick={() => { void selectExpression(null); }}>Reset expression</button>
                <div className="expression-grid">{activeModel?.expressions.map((expression, index) => <button type="button" key={`${expression}:${index}`} disabled={modelStatus !== "ready"} aria-pressed={activeExpression === expression} onClick={() => { void selectExpression(activeExpression === expression ? null : expression); }}>{expression.trim()}</button>)}</div>
                {!activeModel?.expressions.length && <p className="floating-note">{activeModel ? "This model does not include expressions." : "Import a model in Models to discover its expressions."}</p>}
              </>}
              {characterTab === "pose" && <>
                <button type="button" className="floating-option" disabled={modelStatus !== "ready"} onClick={() => { resetReaction(); void selectMotion(null); }}>Reset to idle pose</button>
                {!!activeModel?.poses?.length && <><p className="floating-note">Poses</p><div className="expression-grid">{activeModel.poses.map((pose) => <button type="button" key={pose} disabled={modelStatus !== "ready"} aria-pressed={activeExpression === pose} onClick={() => { void selectExpression(activeExpression === pose ? null : pose); }}>{pose}</button>)}</div></>}
                {[...new Set(activeModel?.motions.map((motion) => motion.group) ?? [])].map((group) => <div className="model-motion-group" key={group}><p className="floating-note">{group || "Default"}</p><div className="expression-grid">{activeModel?.motions.filter((motion) => motion.group === group).map((motion) => <button type="button" key={motion.index} disabled={modelStatus !== "ready"} aria-pressed={activeMotion === `${group}:${motion.index}`} onClick={() => { if (activeMotion === `${group}:${motion.index}`) { resetReaction(); void selectMotion(null); } else void selectMotion(motion); }}>{motion.name}</button>)}</div></div>)}
                {!activeModel?.motions.length && !activeModel?.poses?.length && <p className="floating-note">{activeModel ? "This model does not include playable motions." : "Import a model in Models to discover its motions."}</p>}
              </>}
              {modelNotice && <p className="model-notice" role="alert">{modelNotice}</p>}
            </>}
            {panel === "scenes" && <><SceneManager library={sceneLibrary}/><p className="floating-note">Default backgrounds</p><div className="scene-grid">{(Object.keys(BACKGROUNDS) as Array<keyof typeof BACKGROUNDS>).map((scene) => <button key={scene} type="button" disabled={sceneLibrary.busy || !sceneLibrary.ready} className={!activeCustomSceneId && selectedPreset === scene ? "is-selected" : ""} onClick={() => selectPresetScene(scene)}><span style={{ backgroundImage: `url(${BACKGROUNDS[scene]})` }}/><strong>Christmas {scene}</strong></button>)}</div></>}
            {panel === "voice" && <><button type="button" className="floating-option" onClick={() => setMuted((value) => !value)}><Icon name="sound" size={18}/> Vivian voice <strong>{muted ? "Off" : "On"}</strong></button><label className="floating-range">Speaking speed <span>{speechSpeed.toFixed(2)}×</span><input type="range" min="0.8" max="1.2" step="0.02" value={speechSpeed} onChange={(event) => setSpeechSpeed(Number(event.target.value))}/></label><button type="button" className="floating-option" onClick={() => setLanguageOpen(true)}><Icon name="language" size={18}/> Speech language <strong>{speechLanguage.toUpperCase()}</strong></button><button type="button" className="floating-option" onClick={toggleRecording}><Icon name="mic" size={18}/> Microphone <strong>{recording ? "Listening" : "Start"}</strong></button></>}
             {panel === "status" && <StorageStatusPanel/>}
              {panel === "settings" && <><div className="custom-instructions"><strong>Reset Vivian</strong><p>ล้างความจำ แชต Mood และความสัมพันธ์บนคลาวด์ที่ใช้ร่วมกัน รวมถึงแชตและคำแนะนำส่วนตัวบนอุปกรณ์นี้</p>{resetConfirming ? <div role="alertdialog" aria-label="ยืนยันรีเซ็ต Vivian"><p>ข้อมูลนี้จะถูกลบถาวรจากคลาวด์ที่ใช้ร่วมกันและแชตบนอุปกรณ์นี้ โมเดล การตั้งค่าเสียง และบัญชีล็อกอินจะยังอยู่</p><button type="button" className="floating-option" disabled={sending || resetting} onClick={() => { void resetVivian(); }}>ยืนยันรีเซ็ต Vivian</button><button type="button" className="floating-option" onClick={() => setResetConfirming(false)}>ยกเลิก</button></div> : <button type="button" className="floating-option" disabled={sending || resetting} onClick={() => setResetConfirming(true)}>{resetting ? "กำลังรีเซ็ต…" : "Reset memories and companion"}</button>}{resetNotice && <p role="status">{resetNotice}</p>}</div><div className="custom-instructions"><strong>Custom instructions</strong><p>How should Vivian speak with you?</p><textarea value={customInstructions} maxLength={2000} onChange={(event) => { const value = event.target.value; setCustomInstructions(value); window.localStorage.setItem("vivian-custom-instructions", value); }} placeholder="Call me… Speak in Thai…"/></div><div className="custom-instructions jev-settings"><strong>Jev API <span>{jevConfigured === undefined ? "กำลังตรวจสอบ" : jevConfigured === null ? "ตรวจสอบไม่ได้" : jevConfigured ? "ตั้งค่าแล้ว" : "ยังไม่ได้ตั้งค่า"}</span></strong><p>ตั้งค่า TYPESAFE_API_KEY ใน Environment Variables ของ Vercel หรือ .env.local เพื่อช่วยตัดสินใจเรื่องความจำ เครื่องมือ ภาพ และข้อมูลล่าสุด โดย Vivian ยังตอบด้วยโมเดลสนทนาหลัก</p></div><button type="button" className="floating-option" onClick={() => setLanguageOpen(true)}><Icon name="language" size={18}/> Language <strong>{speechLanguage.toUpperCase()}</strong></button><button type="button" onClick={() => setInfoOpen(true)} className="floating-option"><Icon name="info" size={18}/> About Vivian</button></>}
            {panel === "settings" && <form action="/auth/signout" method="post" className="account-settings"><div><small>ลงชื่อเข้าใช้ด้วย</small><p>{accountEmail}</p></div><button type="submit">ออกจากระบบ <span aria-hidden="true">↗</span></button></form>}
          </div>
        </section>}
      </div>
    </div>
    {languageOpen && <div className="chat-backdrop" role="presentation" onClick={() => setLanguageOpen(false)}><section className="info-sheet language-sheet" role="dialog" aria-modal="true" aria-label="ล็อกภาษาการพูด" onClick={(event) => event.stopPropagation()}><div className="memory-sheet-head"><div><small>LANGUAGE LOCK</small><h1>ภาษาการพูด</h1><p>ใช้ภาษาเดียวกันทั้งฟังเสียงและตอบด้วยเสียง</p></div><button type="button" onClick={() => setLanguageOpen(false)} aria-label="ปิด"><Icon name="close"/></button></div><div className="language-options">{LANGUAGE_OPTIONS.map((option) => <button key={option.code} type="button" className={speechLanguage === option.code ? "is-selected" : ""} onClick={() => { setSpeechLanguage(option.code); window.localStorage.setItem("vivian-speech-language", option.code); setLanguageOpen(false); }}><strong>{option.nativeName}</strong><span>{option.label} · {option.code.toUpperCase()}</span></button>)}</div></section></div>}
    {infoOpen && <div className="chat-backdrop" role="presentation" onClick={() => setInfoOpen(false)}><section className="info-sheet" role="dialog" aria-modal="true" aria-label="ข้อมูลเวอร์ชัน" onClick={(event) => event.stopPropagation()}><div className="memory-sheet-head"><div><small>VIVIAN INFO</small><h1>ข้อมูลเวอร์ชัน</h1><p>ข้อมูลของ companion เวอร์ชันที่กำลังใช้งาน</p></div><button type="button" onClick={() => setInfoOpen(false)} aria-label="ปิด"><Icon name="close"/></button></div><div className="info-list"><p><strong>App</strong>Vivian AI Companion</p><p><strong>Codename</strong>{APP_CODENAME}</p><p><strong>Version</strong>v1.0.0-stable</p><p><strong>Character</strong>Miss</p></div></section></div>}
  </main>;
}

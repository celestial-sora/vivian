"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/auth/fetch";
import { notifyStorageChanged } from "@/lib/storage-status";
import type { SceneDecision, ScenePreferences, VivianScene } from "@/lib/scenes";

const loadedImages = new Map<string, Promise<void>>();
export function preloadSceneImage(url: string): Promise<void> {
  const previous = loadedImages.get(url);
  if (previous) return previous;
  const promise = new Promise<void>((resolve, reject) => {
    const image = new Image();
    const timer = window.setTimeout(() => { image.src = ""; reject(new Error("Scene image did not load.")); }, 10_000);
    image.onload = () => { window.clearTimeout(timer); resolve(); };
    image.onerror = () => { window.clearTimeout(timer); reject(new Error("Scene image is unavailable. Your current background was kept.")); };
    image.src = url;
  }).catch((error) => { loadedImages.delete(url); throw error; });
  loadedImages.set(url, promise);
  // Bound this session cache; the browser manages actual image memory.
  if (loadedImages.size > 100) loadedImages.delete(loadedImages.keys().next().value!);
  return promise;
}
export async function sceneRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await authFetch(path, { ...options, signal: options?.signal ?? AbortSignal.timeout(25_000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Could not save scene changes. Please try again.");
  if (options?.method && options.method !== "GET") notifyStorageChanged();
  return data as T;
}
const defaults: ScenePreferences = { autoScene: false, activeSceneId: null, preset: null, revision: "" };
export function useSceneLibrary() {
  const [scenes, setScenes] = useState<VivianScene[]>([]);
  const [preferences, setPreferences] = useState<ScenePreferences>(defaults);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const preferencesRef = useRef(preferences);
  const scenesRef = useRef(scenes);
  const refresh = useCallback(async () => {
    const data = await sceneRequest<{ scenes: VivianScene[]; preferences: ScenePreferences }>("/api/scenes");
    if (mounted.current) { scenesRef.current = data.scenes; preferencesRef.current = data.preferences; setScenes(data.scenes); setPreferences(data.preferences); setReady(true); setNotice(null); }
  }, []);
  const invalidateRequests = useCallback(() => { generation.current++; }, []);
  useEffect(() => {
    mounted.current = true;
    void refresh().catch((error: Error) => { if (mounted.current) setNotice(error.message); });
    return () => { mounted.current = false; invalidateRequests(); };
  }, [refresh, invalidateRequests]);
  async function updatePreferences(value: Partial<ScenePreferences>) {
    generation.current++;
    setBusy(true); setNotice(null);
    try {
      const next = await sceneRequest<{ preferences: ScenePreferences }>("/api/scenes/preferences", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
      preferencesRef.current = next.preferences; setPreferences(next.preferences);
    } catch (error) { setNotice((error as Error).message); }
    finally { setBusy(false); }
  }
  async function selectScene(id: string) {
    const scene = scenesRef.current.find((item) => item.id === id);
    if (!scene) return;
    generation.current++;
    setBusy(true); setNotice(null);
    try {
      await preloadSceneImage(scene.imageUrl);
      await updatePreferences({ activeSceneId: id });
    } catch (error) { setNotice((error as Error).message); }
    finally { setBusy(false); }
  }
  function applyChatScene(decision: SceneDecision | undefined, requestGeneration: number) {
    if (generation.current !== requestGeneration || !preferencesRef.current.autoScene || !decision?.change) return;
    const scene = scenesRef.current.find((item) => item.id === decision.id);
    if (!scene) return;
    // This work is deliberately detached from text/TTS completion.
    void preloadSceneImage(scene.imageUrl).then(() => {
      if (!mounted.current || generation.current !== requestGeneration || !preferencesRef.current.autoScene) return;
      const next = { ...preferencesRef.current, activeSceneId: scene.id, preset: null };
      preferencesRef.current = next; setPreferences(next);
    }).catch(() => { /* Presentation failures keep the existing background. */ });
  }
  return { scenes, preferences, ready, busy, notice, getGeneration: () => generation.current, invalidateRequests, setNotice, refresh, selectScene, updatePreferences, applyChatScene };
}
export type SceneLibrary = ReturnType<typeof useSceneLibrary>;

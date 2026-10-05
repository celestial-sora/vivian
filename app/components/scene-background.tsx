"use client";
import { useEffect, useState } from "react";
import { preloadSceneImage } from "@/lib/scene-preload";

export function SceneBackground({ source }: { source: string }) {
  const [layers, setLayers] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    void preloadSceneImage(source).then(() => {
      if (!cancelled) setLayers((previous) => previous.at(-1) === source ? previous : [...previous.slice(-1), source]);
    }).catch(() => { /* Retain the loaded scene/default without a flash. */ });
    return () => { cancelled = true; };
  }, [source]);
  useEffect(() => {
    if (layers.length < 2) return;
    const timer = window.setTimeout(() => setLayers((previous) => previous.slice(-1)), 450);
    return () => window.clearTimeout(timer);
  }, [layers]);
  return <>{layers.map((url, index) => <div key={url} className={`scene-background scene-layer${layers.length > 1 && index === layers.length - 1 ? " scene-entering" : ""}`} style={{ backgroundImage: `url("${url}")` }} aria-hidden="true" />)}</>;
}

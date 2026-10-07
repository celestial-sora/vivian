"use client";
import { useEffect, useState } from "react";
import { isSceneImageReady, preloadSceneImage } from "@/lib/scene-preload";
import { startTiming, finishTiming, cancelTiming, type LocalTiming } from "@/lib/performance";

export function SceneBackground({ source, preview, timing }: { source: string; preview?: string; timing?: LocalTiming }) {
  const [loaded, setLoaded] = useState({ source: "", fade: false });
  const fullReady = loaded.source === source || isSceneImageReady(source);
  useEffect(() => {
    let cancelled = false;
    const cacheHit = isSceneImageReady(source);
    const loadTiming = startTiming("scene_load_to_full_image");
    void preloadSceneImage(source).then(() => {
      if (!cancelled) { setLoaded({ source, fade: !cacheHit }); finishTiming(loadTiming, { cacheHit }); }
    }).catch(() => { finishTiming(loadTiming, { cacheHit, failed: true }); });
    return () => { cancelled = true; cancelTiming(loadTiming); };
  }, [source, timing]);
  useEffect(() => {
    // The target full image/preview/placeholder is in the DOM before this mark.
    const frame = requestAnimationFrame(() => finishTiming(timing, { cacheHit: isSceneImageReady(source), presentation: fullReady ? "full" : preview ? "preview" : "placeholder" }));
    return () => cancelAnimationFrame(frame);
  }, [source, preview, timing, fullReady]);
  return <>
    <div key={`preview:${source}`} className="scene-background scene-layer" style={{ backgroundImage: preview ? `url("${preview}")` : "linear-gradient(145deg, #352944, #171b2c)" }} aria-hidden="true" />
    {fullReady && <div key={source} className={`scene-background scene-layer${loaded.source === source && loaded.fade ? " scene-entering" : ""}`} style={{ backgroundImage: `url("${source}")` }} aria-hidden="true" />}
  </>;
}

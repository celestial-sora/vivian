"use client";
/* Private authenticated image routes intentionally use native img, avoiding an
 * unauthenticated optimizer fetch or leaking storage references. */
/* eslint-disable @next/next/no-img-element */
import { useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/auth/fetch";
import { SCENE_MAX_BYTES, SCENE_MAX_COUNT, SCENE_MIME_TYPES, validateSceneLabel, type VivianScene } from "@/lib/scenes";
import { sceneRequest, type SceneLibrary } from "@/lib/use-scene-library";

export function SceneManager({ library }: { library: SceneLibrary }) {
  const [editor, setEditor] = useState<{ scene?: VivianScene; replace: boolean } | null>(null);
  const [label, setLabel] = useState("");
  const [mode, setMode] = useState<"upload" | "url">("upload");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const labelInput = useRef<HTMLInputElement>(null);
  const previewRequest = useRef<AbortController | null>(null);
  useEffect(() => () => { previewRequest.current?.abort(); }, []);
  useEffect(() => () => { if (preview?.startsWith("blob:")) URL.revokeObjectURL(preview); }, [preview]);
  function closeMenu(event: React.MouseEvent<HTMLButtonElement>) {
    const menu = event.currentTarget.closest("details");
    if (menu) menu.open = false;
  }
  function open(scene?: VivianScene, replace = true) {
    previewRequest.current?.abort();
    setEditor({ scene, replace }); setLabel(scene?.label ?? ""); setMode("upload"); setFile(null); setUrl(""); setPreview(scene?.imageUrl ?? null); setError(null); setSuccess(null);
    window.setTimeout(() => labelInput.current?.focus(), 0);
  }
  function chooseFile(image?: File) {
    setError(null); setPreview(null); setFile(null);
    if (!image) return;
    if (!SCENE_MIME_TYPES.includes(image.type) || image.size > SCENE_MAX_BYTES || !image.size) { setError("Choose a JPG, PNG, WebP or AVIF image under 8 MB."); return; }
    setFile(image); setPreview(URL.createObjectURL(image));
  }
  async function previewUrl() {
    setWorking(true); setError(null); setPreview(null);
    const controller = new AbortController(); previewRequest.current = controller;
    try {
      validateSceneLabel(label);
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Enter an HTTP or HTTPS image URL.");
      const response = await authFetch("/api/scenes/preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label, url }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
      if (!response.ok) throw new Error((await response.json()).error ?? "Image import failed.");
      const blob = await response.blob();
      if (!controller.signal.aborted) setPreview(URL.createObjectURL(blob));
    } catch (error) { if (!controller.signal.aborted) setError((error as Error).message === "Invalid URL" ? "Enter a valid image URL." : (error as Error).message); }
    finally { setWorking(false); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setWorking(true); setError(null);
    try {
      const validatedLabel = validateSceneLabel(label);
      let options: RequestInit;
      if (editor?.replace && mode === "upload") {
        if (!file) throw new Error("Choose an image.");
        const body = new FormData(); body.set("label", validatedLabel); body.set("image", file);
        options = { body };
      } else options = { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ label: validatedLabel, ...(editor?.replace ? { url } : {}) }) };
      const { scene } = await sceneRequest<{ scene: VivianScene }>(editor?.scene ? `/api/scenes/${editor.scene.id}` : "/api/scenes", { ...options, method: editor?.scene ? "PATCH" : "POST" });
      library.invalidateRequests();
      await library.refresh();
      setEditor(null); setSuccess(`Saved ${scene.label}.`);
    } catch (error) { setError((error as Error).message); }
    finally { setWorking(false); }
  }
  async function remove(scene: VivianScene) {
    setWorking(true); setError(null);
    try {
      await sceneRequest(`/api/scenes/${scene.id}`, { method: "DELETE" });
      library.invalidateRequests();
      await library.refresh(); setDeleting(null); setSuccess("Scene deleted.");
    } catch (error) { setError((error as Error).message); }
    finally { setWorking(false); }
  }
  return <div className="scene-manager">
    <button type="button" className="floating-option scene-auto-toggle" role="switch" aria-checked={library.preferences.autoScene} disabled={!library.ready || library.busy || working} onClick={() => void library.updatePreferences({ autoScene: !library.preferences.autoScene })}>AI Auto Scene <strong>{library.preferences.autoScene ? "ON" : "OFF"}</strong></button>
    <p className="floating-note">Your labels tell Vivian what each scene means. Scenes switch immediately; a preview appears while the full image loads.</p>
    {library.notice && <div role="alert" className="model-notice">{library.notice}{!library.ready && <button type="button" className="floating-option" onClick={() => void library.refresh().catch((error: Error) => library.setNotice(error.message))}>Retry loading scenes</button>}</div>}
    {success && <p role="status" className="floating-note">{success}</p>}
    {!editor && <button type="button" className="floating-option scene-upload" disabled={!library.ready || working || library.scenes.length >= SCENE_MAX_COUNT} onClick={() => open()}>+ Add Scene</button>}
    {editor && <form className="scene-editor" aria-label={editor.scene ? "Edit Scene" : "Add Scene"} onSubmit={(event) => void save(event)}>
      <h3>{editor.scene ? editor.replace ? "Replace Image" : "Edit Label" : "Add Scene"}</h3>
      <label>Scene label<input ref={labelInput} value={label} maxLength={100} required placeholder="ห้องนอนตอนกลางคืน" onChange={(event) => setLabel(event.target.value)} disabled={working}/></label>
      <small>{[...label.trim().normalize("NFC")].length}/50 characters</small>
      {editor.replace && <>
        <p className="floating-note">Image source</p>
        <div className="floating-tabs">{(["upload", "url"] as const).map((value) => <button type="button" key={value} aria-pressed={mode === value} className={mode === value ? "is-selected" : ""} disabled={working} onClick={() => { setMode(value); setPreview(null); setError(null); }}>{value === "upload" ? "Upload Image" : "Image URL"}</button>)}</div>
        {mode === "upload" ? <>
          <input ref={fileInput} type="file" aria-label="Scene image file" accept={SCENE_MIME_TYPES.join(",")} hidden onChange={(event) => { chooseFile(event.target.files?.[0]); event.target.value = ""; }}/>
          <button type="button" className="scene-drop-area" disabled={working} onClick={() => fileInput.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (!working) chooseFile(event.dataTransfer.files[0]); }}>{file ? file.name : "Choose or drop an image"}<small>JPG, PNG, WebP or AVIF · up to 8 MB</small></button>
        </> : <><label>Image URL<input type="url" required value={url} placeholder="https://example.com/wallpaper.jpg" disabled={working} onChange={(event) => { setUrl(event.target.value); setPreview(null); }}/></label><button type="button" className="floating-option" disabled={working || !url} onClick={() => void previewUrl()}>Preview image</button></>}
      </>}
      {preview && <div className="scene-preview"><p className="floating-note">Preview</p><img src={preview} alt="Scene preview" onError={() => { setPreview(null); setError("Could not preview this image. Choose a valid image."); }}/></div>}
      {error && <p className="model-notice" role="alert">{error}</p>}
      <div className="scene-editor-actions"><button type="button" className="floating-option" disabled={working} onClick={() => { setEditor(null); setPreview(null); setError(null); }}>Cancel</button><button type="submit" className="floating-option model-import-primary" disabled={working}>{working ? "Working…" : "Save Scene"}</button></div>
    </form>}
    {!editor && error && <p className="model-notice" role="alert">{error}</p>}
    {!library.ready && !library.notice && <p className="floating-note" role="status">Loading scenes…</p>}
    {!editor && library.ready && !library.scenes.length && <p className="floating-empty">Add an image and write its label to start your scene library.</p>}
    <div className="custom-scene-grid">{library.scenes.map((scene) => <article key={scene.id} className={library.preferences.activeSceneId === scene.id ? "is-selected" : ""}>
      <button type="button" className="custom-scene-select" disabled={working} aria-pressed={library.preferences.activeSceneId === scene.id} onClick={() => void library.selectScene(scene.id)}>
        <img className="custom-scene-image" src={scene.thumbnailUrl} alt="" loading="lazy"/><strong>{scene.label}</strong><small>{library.preferences.activeSceneId === scene.id ? "Current scene" : "Apply scene"}</small>
      </button>
      <details className="scene-card-menu"><summary aria-label={`Actions for ${scene.label}`}>…</summary><div><button type="button" disabled={working} onClick={(event) => { closeMenu(event); open(scene, false); }}>Edit label</button><button type="button" disabled={working} onClick={(event) => { closeMenu(event); open(scene); }}>Replace image</button><button type="button" disabled={working} onClick={(event) => { closeMenu(event); setDeleting(scene.id); }}>Delete scene</button></div></details>
      {deleting === scene.id && <div className="scene-delete-confirm" role="group" aria-label={`Delete ${scene.label}?`}><p>Delete this scene?</p><button type="button" className="floating-option" disabled={working} onClick={() => void remove(scene)}>Confirm delete</button><button type="button" className="floating-option" disabled={working} onClick={() => setDeleting(null)}>Cancel</button></div>}
    </article>)}</div>
  </div>;
}

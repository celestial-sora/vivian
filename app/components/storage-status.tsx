"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "@/lib/auth/fetch";
import { formatStorageBytes, storagePercentage, type StorageStatus } from "@/lib/storage-status";

function StorageMeter({ name, used, limit, description }: { name: string; used: number | null; limit: number; description?: string }) {
  const percentage = used === null ? null : storagePercentage(used, limit);
  return <article className="storage-status-card">
    <div className="storage-status-heading"><strong>{name}</strong><span>{percentage === null ? "Unavailable" : `${percentage.toFixed(1)}%`}</span></div>
    <progress aria-label={`${name} storage usage`} max={100} value={percentage === null ? 0 : Math.min(100, percentage)} className={percentage !== null && percentage >= 90 ? "is-near-limit" : ""} />
    <p>{used === null ? "Usage could not be checked" : `${formatStorageBytes(used)} used`}<span>{formatStorageBytes(limit)} capacity</span></p>
    {description && <small>{description}</small>}
  </article>;
}
export function StorageStatusPanel() {
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (inFlight.current || document.hidden) return;
    inFlight.current = true; setRefreshing(true);
    const abort = new AbortController(); controller.current = abort;
    try {
      const response = await authFetch("/api/storage/status", { cache: "no-store", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(12_000)]) });
      if (!response.ok) throw new Error("Storage status is temporarily unavailable.");
      const next = await response.json() as StorageStatus;
      if (!abort.signal.aborted) { setStatus(next); setNotice(null); }
    } catch {
      if (!abort.signal.aborted) setNotice("Could not refresh storage usage. Showing the last available update.");
    } finally { inFlight.current = false; if (!abort.signal.aborted) setRefreshing(false); }
  }, []);
  useEffect(() => {
    const initial = window.setTimeout(() => { void refresh(); }, 0);
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    const update = () => { void refresh(); };
    window.addEventListener("vivian-storage-changed", update);
    document.addEventListener("visibilitychange", update);
    return () => { window.clearTimeout(initial); window.clearInterval(timer); controller.current?.abort(); window.removeEventListener("vivian-storage-changed", update); document.removeEventListener("visibilitychange", update); };
  }, [refresh]);
  return <div className="storage-status-panel">
    <p className="floating-note">Storage usage refreshes every 5 seconds while this panel is open.</p>
    <StorageMeter name="Supabase" used={status?.supabase.usedBytes ?? null} limit={status?.supabase.limitBytes ?? 1e9} description="File storage in this Supabase project." />
    <StorageMeter name="Cloudflare R2" used={status?.r2.usedBytes ?? null} limit={status?.r2.limitBytes ?? 10e9} description={status?.r2.connected ? "Private storage · Includes uploads and files awaiting deletion." : "R2 connection is not available."} />
    <div className="storage-category-meters">
      <StorageMeter name="Live2D models" used={status?.r2.categories?.live2d.used ?? null} limit={8e9} />
      <StorageMeter name="Other files" used={status?.r2.categories?.other.used ?? null} limit={2e9} />
    </div>
    <div className="storage-status-footer"><small>{status ? `Checked ${new Date(status.checkedAt).toLocaleTimeString()}` : "Waiting for storage status…"}</small><button type="button" className="floating-option" disabled={refreshing} onClick={() => { void refresh(); }}>{refreshing ? "Refreshing…" : "Refresh"}</button></div>
    {notice && <p role="status" className="model-notice">{notice}</p>}
  </div>;
}

import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { storageUsage } from "@/lib/cloud-store";
import { r2Configuration } from "@/lib/r2";
import { STORAGE_LIMITS } from "@/lib/cloud-storage";
import type { StorageStatus } from "@/lib/storage-status";
export async function getStorageStatus(db: SupabaseClient): Promise<StorageStatus> {
  const configuredLimit = Number(process.env.SUPABASE_STORAGE_LIMIT_BYTES ?? 1_000_000_000);
  const supabaseLimit = Number.isSafeInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : 1_000_000_000;
  const [supabase, r2] = await Promise.allSettled([
    Promise.resolve(db.rpc("vivian_supabase_storage_bytes")).then(({ data, error }) => {
      if (error || data === null || !Number.isSafeInteger(Number(data)) || Number(data) < 0) throw new Error("Usage unavailable");
      return Number(data);
    }),
    storageUsage(db),
  ]);
  let r2Connected = false;
  try { r2Configuration(); r2Connected = true; } catch { /* No credentials exposed. */ }
  const categories = r2.status === "fulfilled" ? r2.value : null;
  return {
    supabase: { usedBytes: supabase.status === "fulfilled" ? supabase.value : null, limitBytes: supabaseLimit, connected: supabase.status === "fulfilled" },
    r2: { usedBytes: categories ? categories.live2d.used + categories.other.used : null, limitBytes: STORAGE_LIMITS.live2d + STORAGE_LIMITS.other, connected: r2Connected && !!categories, categories },
    checkedAt: new Date().toISOString(),
  };
}

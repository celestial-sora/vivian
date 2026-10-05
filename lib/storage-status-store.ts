import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { observedR2Accounting } from "@/lib/cloud-store";
import { r2Inventory } from "@/lib/r2";
import { STORAGE_BUDGET_BYTES, inventoryUsage } from "@/lib/cloud-storage";
import type { StorageStatus } from "@/lib/storage-status";
export async function getStorageStatus(db: SupabaseClient): Promise<StorageStatus> {
  const configuredLimit = Number(process.env.SUPABASE_STORAGE_LIMIT_BYTES ?? 1_000_000_000);
  const supabaseLimit = Number.isSafeInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : 1_000_000_000;
  const inventory = r2Inventory();
  const [supabase, r2, quota] = await Promise.allSettled([
    Promise.resolve(db.rpc("vivian_supabase_storage_bytes")).then(({ data, error }) => {
      if (error || data === null || !Number.isSafeInteger(Number(data)) || Number(data) < 0) throw new Error("Usage unavailable");
      return Number(data);
    }),
    inventory.then(inventoryUsage),
    inventory.then(objects => observedR2Accounting(db, objects)).then(accounting => accounting.usage),
  ]);
  const categories = r2.status === "fulfilled" ? r2.value : null;
  return {
    supabase: { usedBytes: supabase.status === "fulfilled" ? supabase.value : null, limitBytes: supabaseLimit, connected: supabase.status === "fulfilled" },
    r2: { usedBytes: categories ? categories.live2d.used + categories.other.used : null, limitBytes: STORAGE_BUDGET_BYTES, connected: !!categories, categories, quotaUsage: quota.status === "fulfilled" ? quota.value : null },
    checkedAt: new Date().toISOString(),
  };
}

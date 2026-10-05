import type { StorageUsage } from "@/lib/cloud-storage";
export interface ProviderStorageStatus { usedBytes: number | null; limitBytes: number; connected: boolean }
export interface StorageStatus {
  supabase: ProviderStorageStatus;
  r2: ProviderStorageStatus & { categories: StorageUsage | null };
  checkedAt: string;
}
export function storagePercentage(usedBytes: number, limitBytes: number): number {
  return Math.max(0, usedBytes / limitBytes * 100);
}
export function formatStorageBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1e6) return `${(bytes / 1000).toFixed(1)} KB`;
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e9).toFixed(2)} GB`;
}
export function notifyStorageChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("vivian-storage-changed"));
}

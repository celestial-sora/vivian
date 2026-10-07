/** Retry an interrupted startup once, while keeping a guard against repeated GPU crashes. */
export function shouldPauseModelStartup(storage: Pick<Storage, "getItem" | "setItem">, selected: string | null): boolean {
  if (!selected || storage.getItem("vivian-model-loading") !== selected) return false;
  if (storage.getItem("vivian-model-retry") === selected) return true;
  storage.setItem("vivian-model-retry", selected);
  return false;
}

/** Cleanup during hydration retains the retry guard; a normal exit/success resets it. */
export function clearModelLoadState(storage: Pick<Storage, "getItem" | "removeItem">, selected: string, completed = false): void {
  if (storage.getItem("vivian-model-loading") === selected) storage.removeItem("vivian-model-loading");
  if (completed && storage.getItem("vivian-model-retry") === selected) storage.removeItem("vivian-model-retry");
}

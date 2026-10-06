/** Cubism must exist before importing pixi-live2d-display (it checks at module evaluation). */
export async function waitForCubismCore(signal: AbortSignal, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(globalThis as typeof globalThis & { Live2DCubismCore?: unknown }).Live2DCubismCore) {
    signal.throwIfAborted();
    if (Date.now() >= deadline) throw new Error("Live2D runtime did not load. Please reload the model or refresh the page.");
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
  }
  signal.throwIfAborted();
}

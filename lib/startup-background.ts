/** Release optional work after the model's first frame; a bounded fallback also
 * serves empty libraries, unavailable assets and background tabs. */
export function scheduleBackgroundWork(work: () => void, delayMs = 2500): () => void {
  let cancelled = false, started = false;
  let idle: number | undefined, frame: number | undefined;
  const run = () => { if (!cancelled && !started) { started = true; work(); } };
  const release = () => {
    window.removeEventListener("vivian-model-first-frame", release);
    window.clearTimeout(timer);
    frame = requestAnimationFrame(() => {
      if (typeof window.requestIdleCallback === "function") idle = window.requestIdleCallback(run, { timeout: 500 });
      else frame = requestAnimationFrame(run);
    });
  };
  const timer = window.setTimeout(run, delayMs);
  window.addEventListener("vivian-model-first-frame", release);
  return () => {
    cancelled = true; window.clearTimeout(timer);
    window.removeEventListener("vivian-model-first-frame", release);
    if (frame !== undefined) cancelAnimationFrame(frame);
    if (idle !== undefined) window.cancelIdleCallback(idle);
  };
}

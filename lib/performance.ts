/** Local User Timing only. Never include text, audio, credentials or private URLs. */
export interface LocalTiming { name: string; start: number; mark: string; done: boolean }
let sequence = 0;
const measures: string[] = [];
export function startTiming(name: string, start?: number): LocalTiming | undefined {
  if (typeof window === "undefined" || typeof performance?.mark !== "function") return;
  const at = start ?? performance.now();
  const mark = `vivian:${name}:${++sequence}:start`;
  try { performance.mark(mark, { startTime: at }); } catch { return; }
  return { name, start: at, mark, done: false };
}
export function finishTiming(timing: LocalTiming | undefined, detail: Record<string, string | number | boolean> = {}): void {
  if (!timing || timing.done) return;
  timing.done = true;
  const name = timing.mark.replace(/:start$/, "");
  try { performance.measure(name, { start: timing.start, end: performance.now(), detail }); }
  catch { /* User Timing is optional on older or restricted browsers. */ }
  try { performance.clearMarks(timing.mark); } catch { /* Optional instrumentation. */ }
  measures.push(name);
  if (measures.length > 200) { try { performance.clearMeasures(measures.shift()!); } catch { /* Optional instrumentation. */ } }
  if (process.env.NODE_ENV === "development") console.debug(`[performance] ${timing.name}`, { ms: Math.round(performance.now() - timing.start), ...detail });
}
export function cancelTiming(timing: LocalTiming | undefined): void {
  if (!timing || timing.done) return;
  timing.done = true;
  try { performance.clearMarks(timing.mark); } catch { /* Optional instrumentation. */ }
}

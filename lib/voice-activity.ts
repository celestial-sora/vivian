// Browser-side endpoint detection: a pause is not the end of a sentence.
export const END_OF_SPEECH_MS = 2500;
export interface VoiceActivityState {
  noiseFloor: number;
  speechStartedAt: number | null;
  heardSpeech: boolean;
  quietSince: number | null;
}
export function createVoiceActivity(): VoiceActivityState {
  return { noiseFloor: .003, speechStartedAt: null, heardSpeech: false, quietSince: null };
}
export function updateVoiceActivity(state: VoiceActivityState, rms: number, now: number): boolean {
  const startThreshold = Math.max(.018, Math.min(.06, state.noiseFloor * 2.8));
  // A lower continuation threshold preserves soft syllables and sentence tails.
  const threshold = state.heardSpeech ? Math.max(.012, startThreshold * .55) : startThreshold;
  if (rms > threshold) {
    state.speechStartedAt ??= now;
    if (now - state.speechStartedAt >= 180) state.heardSpeech = true;
    state.quietSince = null;
  } else {
    // Learn only quiet frames; learning the user's voice as noise raises the
    // threshold mid-sentence and incorrectly cuts off continued speech.
    if (rms < startThreshold * .55) state.noiseFloor = state.noiseFloor * .98 + rms * .02;
    if (!state.heardSpeech) state.speechStartedAt = null;
    else state.quietSince ??= now;
  }
  return state.heardSpeech && state.quietSince !== null && now - state.quietSince >= END_OF_SPEECH_MS;
}

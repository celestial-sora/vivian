export const DEFAULT_SPEAKING_SPEED = .98;
export function validSpeakingSpeed(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= .8 && value <= 1.2;
}

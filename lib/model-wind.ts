interface WindVector {
  x: number;
  y: number;
}

export interface WindInternalModel {
  coreModel: {
    getModel(): { parameters: { ids: readonly string[]; minimumValues: ArrayLike<number>; maximumValues: ArrayLike<number> } };
    addParameterValueByIndex(index: number, value: number): void;
  };
  physics?: { getOption(): { wind: WindVector } };
  on(event: "beforeMotionUpdate" | "beforeModelUpdate", listener: () => void): unknown;
  off(event: "beforeMotionUpdate" | "beforeModelUpdate", listener: () => void): unknown;
}

interface WindOptions {
  now?: () => number;
  reducedMotion?: () => boolean;
}

const clamp = (value: number): number => Math.max(-1, Math.min(1, value));
const WIND_STRENGTH = 0.5;

// Cubism's own physics knows which parameters move this artist's hair/clothes.
// Change its wind before evaluation, rather than guessing output parameter IDs.
export function attachModelWind(canvas: HTMLCanvasElement, model: WindInternalModel, options: WindOptions = {}): () => void {
  const now = options.now ?? (() => performance.now());
  const motionPreference = options.reducedMotion ? undefined : window.matchMedia("(prefers-reduced-motion: reduce)");
  const reducedMotion = options.reducedMotion ?? (() => motionPreference?.matches === true);
  const physicsWind = model.physics?.getOption().wind;
  const originalWind = physicsWind ? { ...physicsWind } : undefined;
  const parameters = model.coreModel.getModel().parameters;
  const fallbackHair = physicsWind ? [] : ["ParamHairFront", "ParamHairSide", "ParamHairBack", "ParamHairFluffy"]
    .map((id) => parameters.ids.indexOf(id)).filter((index) => index >= 0);
  const bodyRoll = parameters.ids.indexOf("ParamBodyAngleZ");
  let previousPointer: { id: number; x: number; y: number; at: number } | undefined;
  let previousUpdate = now();
  let targetX = 0;
  let targetY = 0;
  let forceX = 0;
  let forceY = 0;

  const rememberPointer = (event: PointerEvent): void => {
    if (event.isPrimary === false) return;
    previousPointer = { id: event.pointerId, x: event.clientX, y: event.clientY, at: now() };
  };
  const movePointer = (event: PointerEvent): void => {
    if (event.isPrimary === false) return;
    const at = now();
    if (previousPointer && previousPointer.id === event.pointerId && !reducedMotion()) {
      const elapsed = Math.max(16, at - previousPointer.at);
      const dx = event.clientX - previousPointer.x;
      const dy = previousPointer.y - event.clientY;
      if (dx || dy) {
        targetX = clamp(dx / elapsed * 0.9);
        targetY = clamp(dy / elapsed * 0.9);
      }
    }
    previousPointer = { id: event.pointerId, x: event.clientX, y: event.clientY, at };
  };
  const endPointer = (event: PointerEvent): void => {
    if (previousPointer?.id === event.pointerId) previousPointer = undefined;
  };
  const updateWind = (): void => {
    const at = now();
    const dt = Math.max(0, at - previousUpdate) / 1000;
    previousUpdate = at;
    if (reducedMotion()) {
      targetX = targetY = forceX = forceY = 0;
    } else {
      // Pointer events update force, never the flutter clock. Continuous
      // movement must stay visible instead of restarting at zero each event.
      targetX *= Math.exp(-dt / 0.65);
      targetY *= Math.exp(-dt / 0.65);
      const blend = 1 - Math.exp(-dt / 0.1);
      forceX += (targetX - forceX) * blend;
      forceY += (targetY - forceY) * blend;
      if (Math.abs(forceX) < 0.001 && Math.abs(targetX) < 0.001) forceX = targetX = 0;
      if (Math.abs(forceY) < 0.001 && Math.abs(targetY) < 0.001) forceY = targetY = 0;
    }
    if (physicsWind && originalWind) {
      const flutter = 0.92 + 0.08 * Math.sin(at / 140);
      physicsWind.x = originalWind.x + forceX * 0.55 * WIND_STRENGTH * flutter;
      physicsWind.y = originalWind.y + forceY * 0.2 * WIND_STRENGTH * flutter;
    }
  };
  const applySway = (): void => {
    if (bodyRoll >= 0) model.coreModel.addParameterValueByIndex(bodyRoll, forceX * (parameters.maximumValues[bodyRoll] - parameters.minimumValues[bodyRoll]) * 0.04 * WIND_STRENGTH);
    for (const index of fallbackHair) {
      model.coreModel.addParameterValueByIndex(index, forceX * (parameters.maximumValues[index] - parameters.minimumValues[index]) * 0.18 * WIND_STRENGTH);
    }
  };

  canvas.addEventListener("pointerenter", rememberPointer, { passive: true });
  canvas.addEventListener("pointerdown", rememberPointer, { passive: true });
  canvas.addEventListener("pointermove", movePointer, { passive: true });
  canvas.addEventListener("pointerleave", endPointer, { passive: true });
  canvas.addEventListener("pointerup", endPointer, { passive: true });
  canvas.addEventListener("pointercancel", endPointer, { passive: true });
  model.on("beforeMotionUpdate", updateWind);
  model.on("beforeModelUpdate", applySway);

  return (): void => {
    canvas.removeEventListener("pointerenter", rememberPointer);
    canvas.removeEventListener("pointerdown", rememberPointer);
    canvas.removeEventListener("pointermove", movePointer);
    canvas.removeEventListener("pointerleave", endPointer);
    canvas.removeEventListener("pointerup", endPointer);
    canvas.removeEventListener("pointercancel", endPointer);
    model.off("beforeMotionUpdate", updateWind);
    model.off("beforeModelUpdate", applySway);
    if (physicsWind && originalWind) Object.assign(physicsWind, originalWind);
  };
}

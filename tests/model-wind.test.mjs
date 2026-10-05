import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { attachModelWind } from "../lib/model-wind.ts";

function harness({ physics = true, ids = ["ArtistHairPhysics17", "ParamEyeBallX", "ParamBodyAngleZ"] } = {}) {
  let clock = 0;
  let reducedMotion = false;
  const canvas = new EventTarget();
  const wind = { x: 0.07, y: -0.02 };
  const writes = [];
  const model = new EventEmitter();
  model.coreModel = {
    getModel: () => ({ parameters: { ids, minimumValues: ids.map(() => -10), maximumValues: ids.map(() => 10) } }),
    addParameterValueByIndex: (index, value) => writes.push({ id: ids[index], value }),
  };
  if (physics) model.physics = { getOption: () => ({ wind }) };
  const dispose = attachModelWind(canvas, model, { now: () => clock, reducedMotion: () => reducedMotion });
  return {
    wind, writes, model, dispose,
    reduce: () => { reducedMotion = true; },
    pointer(type, x, y = 0, pointerId = 1) {
      canvas.dispatchEvent(Object.assign(new Event(type), { clientX: x, clientY: y, pointerId, isPrimary: true }));
    },
    frame(dt = 16) {
      clock += dt;
      model.emit("beforeMotionUpdate");
      model.emit("beforeModelUpdate");
    },
  };
}

test("continuous movement keeps wind active, reverses direction, then settles", () => {
  const h = harness();
  h.pointer("pointerdown", 0);
  for (let i = 1; i <= 25; i++) {
    h.pointer("pointermove", i * 12);
    h.frame();
  }
  assert.ok(h.wind.x < 0.02, "rightward movement must produce negative rig wind while movement continues");
  assert.ok(Math.abs(h.wind.x - 0.07) <= 0.275, "fast swipes must stay within the gentler wind limit");
  assert.ok(h.writes.every(({ id }) => id === "ParamBodyAngleZ"), "artist physics outputs and eye tracking must not be overwritten");
  assert.ok(h.writes.some(({ value }) => value < 0), "body roll must follow the same rig direction as wind");
  for (let i = 1; i <= 25; i++) {
    h.pointer("pointermove", 300 - i * 12);
    h.frame();
  }
  assert.ok(h.wind.x > 0.12, "leftward movement must produce positive rig wind");
  assert.ok(h.writes.at(-1).value > 0, "leftward body roll must agree with wind");
  h.pointer("pointerup", 0);
  for (let i = 0; i < 40; i++) h.frame(250);
  assert.equal(h.wind.x, 0.07);
  assert.equal(h.wind.y, -0.02);
  h.dispose();
});

test("vertical touch swipes create wind and reduced motion immediately restores the artist's baseline", () => {
  const h = harness();
  h.pointer("pointerdown", 0, 300);
  for (let i = 1; i <= 15; i++) {
    h.pointer("pointermove", 0, 300 - i * 15);
    h.frame();
  }
  assert.ok(h.wind.y > 0);
  h.reduce();
  h.frame();
  assert.deepEqual(h.wind, { x: 0.07, y: -0.02 });
  h.dispose();
});

test("switching models restores wind and removes both pointer and frame listeners", () => {
  const h = harness();
  h.pointer("pointerdown", 0);
  h.pointer("pointermove", 100);
  h.frame(100);
  assert.ok(h.wind.x < 0.07);
  h.dispose();
  assert.deepEqual(h.wind, { x: 0.07, y: -0.02 });
  assert.equal(h.model.listenerCount("beforeMotionUpdate"), 0);
  assert.equal(h.model.listenerCount("beforeModelUpdate"), 0);
  h.pointer("pointermove", 200);
  h.frame(100);
  assert.deepEqual(h.wind, { x: 0.07, y: -0.02 });
});

test("models without physics use only supported hair parameters", () => {
  const h = harness({ physics: false, ids: ["ParamHairSide", "ParamEyeBallX", "OutfitToggle"] });
  h.pointer("pointerdown", 0);
  h.pointer("pointermove", 100);
  h.frame(100);
  assert.ok(h.writes.some(({ value }) => value < 0));
  assert.ok(h.writes.every(({ id }) => id === "ParamHairSide"));
  h.dispose();
});

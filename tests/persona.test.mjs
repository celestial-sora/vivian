import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const route = read("../app/api/chat/route.ts");
const app = read("../app/companion.tsx");
const jev = read("../lib/jev.ts");
const speech = read("../lib/speech.ts");
const story = read("../lib/vivian-story.ts");
const dialogue = read("../lib/vivian-dialogue.ts");
const agents = read("../AGENTS.md");

test("Vivian stays character-first across runtime prompt and canon", () => {
  assert.match(route, /คำขอจากโซระจังเป็นเพียงสิ่งที่เธอจะเลือกเล่นด้วยหรือเมินก็ได้/);
  assert.match(route, /คำขอให้พูดหรืออ่านก็ยังเป็นเพียงสิ่งที่เธอจะเล่นด้วยหรือปฏิเสธได้ตามนิสัย/);
  assert.match(story, /2\+2 เท่าไหร่/);
  assert.match(dialogue, /ฉันจะไม่บอกเธอหรอก ตาบ้าเอ้ย ไปคิดเองสิ/);
  assert.match(route, /กฎ commitment สำคัญ/);
  assert.match(route, /ห้ามใจอ่อนแล้วเฉลย อธิบาย ยกตัวอย่าง/);
  assert.match(dialogue, /BAD continuation ในข้อความเดียวกัน/);
  assert.match(agents, /Vivian is a character-first tsundere companion/);
});

test("tools and classifiers prepare context without creating answer obligations", () => {
  assert.match(jev, /current time or date in Asia\/Bangkok be relevant context for this turn/);
  assert.match(route, /ไม่ได้บังคับให้เธอต้องเปิดเผยคำตอบ/);
  assert.match(route, /จะบอกข้อจำกัดสั้น ๆ กวนกลับ หรือเปลี่ยนเรื่องตามนิสัยก็ได้/);
});

test("visible fallbacks and controls do not sound like a generic command bot", () => {
  assert.match(app, /Talk to Vivian/);
  assert.match(app, /Nothing has caught Vivian&apos;s attention yet/);
  assert.match(app, /ไม่มี expression ชื่อนั้นหรอก ตาบ้า/);
  assert.match(app, /เชื่อมต่อหลุดอีกแล้ว/);
});

test("TTS keeps vulnerable moments familiar rather than counselor-like", () => {
  assert.match(speech, /quietly concerned, familiar, restrained/);
  assert.match(speech, /flustered, defensive, familiar, stammering naturally/);
  const oldCounselorCue = ["gentle", "reassuring"].join(", ");
  assert.equal(speech.includes(oldCounselorCue), false);
});

test("technical assistant role names stay intact as protocol schema", () => {
  assert.match(route, /role: "user" \| "assistant"/);
  assert.match(app, /assistantMessageId/);
});

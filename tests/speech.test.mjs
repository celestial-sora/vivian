import assert from "node:assert/strict";
import test from "node:test";
import { fishSpeechText, speechSpeed, speechStyle, speechText } from "../lib/speech.ts";

test("spoken replies omit stage directions and sources but retain dialogue and explanations", () => {
  assert.equal(speechText("(หลบตา) ไม่ได้รอหรอก... **Vivian** อ่าน [เรื่องนี้](https://example.com) (เวอร์ชัน 2)\nแหล่งข้อมูล:\n- https://example.com"), "ไม่ได้รอหรอก… Vivian อ่าน เรื่องนี้ (เวอร์ชัน สอง)");
  assert.equal(speechText("（เม้มปากกลบยิ้ม） ทำได้ดีนี่!"), "ทำได้ดีนี่!");
  assert.equal(speechText("(blushes) I'm not waiting! (version 2)"), "I'm not waiting! (version 2)");
  assert.equal(speechText("(หลบตา)"), "");
});

test("tsundere denials sound flustered and comfort wins over teasing", () => {
  assert.equal(speechStyle("ไม่ได้เป็นห่วงสักหน่อย").delivery, "flustered");
  assert.equal(speechStyle("ไม่เป็นไร ฉันฟังอยู่ ไม่ได้เป็นห่วงสักหน่อย").delivery, "gentle");
  assert.equal(speechStyle("เล่ามาสิ ฉันฟังอยู่~").delivery, "gentle");
  assert.match(speechStyle("ไม่เป็นไร ฉันฟังอยู่").cue, /quietly concerned, familiar, restrained/);
  assert.doesNotMatch(speechStyle("ไม่เป็นไร ฉันฟังอยู่").cue, /reassuring/);
  assert.equal(speechStyle("ทำได้ดีนี่!").delivery, "reserved");
  assert.equal(speechStyle("...ไง มีอะไรเหรอ?").delivery, "reserved");
  assert.equal(speechStyle("โธ่ อย่าแซวสิ").delivery, "teasing");
  assert.equal(speechStyle("ชิ ตาบ้า ไปคิดเองสิ").delivery, "teasing");
  assert.match(speechStyle("ฉันก็ไม่ได้รออยู่หรืออะไรนะ").cue, /flustered, defensive/);
});

test("romaji stammers keep every attempted syllable without spelling the letter B", () => {
  const text = speechText("B- B- Baka!");
  assert.equal(text, "Ba… Ba… Baka!");
  assert.match(speechStyle(text).cue, /flustered, defensive, familiar/);
  assert.match(speechStyle(text).cue, /stammering naturally/);
  assert.equal(speechStyle(text).repetitionPenalty, 1);
  assert.equal(speechStyle("เล่ามาสิ").repetitionPenalty, 1.2);
  assert.match(fishSpeechText(text, speechStyle(text), "s2.1-pro-free", "th"), /พูดไทยกลาง/);
  assert.equal(speechText("B-B-Baka"), "Ba… Ba… Baka");
  assert.equal(speechText("B‑ B‑ Baka"), "Ba… Ba… Baka");
  assert.equal(speechText("B– B– Baka"), "Ba… Ba… Baka");
  assert.equal(speechText("B- Baka"), "Ba… Baka");
  assert.equal(speechText("N- N- No!"), "No… No… No!");
  assert.match(speechStyle("N- N- No!").cue, /stammering naturally/);
  assert.equal(speechText("Use UTF-8 and a B-tree."), "Use UTF-8 and a B-tree.");
  assert.equal(speechStyle("ไม่เป็นไร B- B- Baka").delivery, "gentle");
});

test("stammers work for arbitrary words, scripts, fragments, and apostrophes", () => {
  const cases = [
    ["H-H-Hello!", "He… He… Hello!"],
    ["S- S- Sorry", "So… So… Sorry"],
    ["Th- Th- Thanks", "Tha… Tha… Thanks"],
    ["I- I- I'm here", "I… I… I'm here"],
    ["B- Ba- Baka", "Ba… Ba… Baka"],
    ["ด- ด- เดี๋ยวก่อน", "ด… ด… เดี๋ยวก่อน"],
    ["มะ- มะ- มะม่วง", "มะ… มะ… มะม่วง"],
    ["จะ-จะ-จะพูด", "จะ… จะ… จะพูด"],
    ["ちょ-ちょ-ちょっと", "ちょ… ちょ… ちょっと"],
    ["아-아-아니", "아… 아… 아니"],
    ["我-我-我没有", "我… 我… 我没有"],
    ["ж-ж-жду", "ж… ж… жду"],
    ["é-é-écoute", "é… é… écoute"],
  ];
  for (const [input, expected] of cases) {
    const spoken = speechText(input);
    assert.equal(spoken, expected, input);
    assert.match(speechStyle(spoken).cue, /stammering naturally/, input);
    assert.equal(speechStyle(spoken).repetitionPenalty, 1, input);
  }
  assert.equal(speechText("H- Hello"), "He… Hello");
  assert.match(speechStyle(speechText("H- Hello")).cue, /stammering naturally/);
});

test("compounds, acronyms, and ordinary hesitation retain their meaning", () => {
  for (const input of ["re-read", "ha-ha", "UTF-8", "B-tree", "A-B-C", "well-being"]) {
    assert.equal(speechText(input), input);
    assert.doesNotMatch(speechStyle(input).cue, /stammering/);
  }
  assert.equal(speechText("ฉัน... แค่อยากถาม"), "ฉัน… แค่อยากถาม");
  assert.doesNotMatch(speechStyle("ฉัน… แค่อยากถาม").cue, /stammering/);
});

test("Thai speech receives standard Central Thai delivery without changing spoken words", () => {
  const text = "อย่าเข้าใจผิด ฉันไม่ได้รอหรอก";
  const styled = fishSpeechText(text, speechStyle(text), "s2.1-pro-free", "th");
  assert.match(styled, /พูดไทยกลาง/);
  assert.match(styled, /เขิน/);
  assert.equal(styled.replace(/^\[[^\]]+\] /, ""), text);
  assert.match(fishSpeechText(text, speechStyle(text), "s2-pro"), /พูดไทยกลาง/);
});

test("other languages and older models do not get Thai voice instructions", () => {
  const text = "Don't misunderstand!";
  assert.doesNotMatch(fishSpeechText(text, speechStyle(text), "s2-pro", "en"), /Thai|Isan/);
  assert.doesNotMatch(fishSpeechText(text, speechStyle(text), "s2-pro"), /Thai|Isan/);
  assert.equal(fishSpeechText(text, speechStyle(text), "speech-1.6", "th"), text);
});

test("delivery adjustments respect the voice speed slider limits", () => {
  assert.equal(speechSpeed(.8, speechStyle("ไม่เป็นไร")), .8);
  assert.equal(speechSpeed(2, speechStyle("ไม่ได้รอ")), 1.2);
  assert.equal(speechSpeed(1.1, speechStyle("เล่ามาสิ")), 1.1);
  assert.equal(speechSpeed("fast", speechStyle("เล่ามาสิ")), .98);
});

test("Thai numbers use the context's reading and leave chat text untouched", () => {
  const cases = [
    ["ราคา 1,250 บาท ลด 15%", "ราคา หนึ่งพันสองร้อยห้าสิบบาท ลด สิบห้าเปอร์เซ็นต์"],
    ["เจอกันเวลา 09:30 น.", "เจอกันเวลา เก้านาฬิกา สามสิบนาที"],
    ["ค่าเท่ากับ 3.14", "ค่าเท่ากับ สามจุดหนึ่ง สี่"],
    ["โทร 0812345678", "โทร ศูนย์ แปด หนึ่ง สอง สาม สี่ ห้า หก เจ็ด แปด"],
    ["วันที่ 8 ตุลาคม 2026", "วันที่ แปด ตุลาคม สองพันยี่สิบหก"],
    ["วันที่ 8/10/2026", "วันที่ แปด ตุลาคม สองพันยี่สิบหก"],
    ["เงิน 21.50 บาท", "เงิน ยี่สิบเอ็ดบาทห้าสิบสตางค์"],
    ["เวลา 00:00 น.", "เวลา ศูนย์นาฬิกาตรง"],
    ["ค่า -0.05 ลด 2.5%", "ค่า ลบศูนย์จุดศูนย์ ห้า ลด สองจุดห้าเปอร์เซ็นต์"],
    ["มี 101 คน และ 1000001 ชิ้น", "มี หนึ่งร้อยเอ็ด คน และ หนึ่งล้านหนึ่ง ชิ้น"],
    ["ราคา ๑๒๕ บาท", "ราคา หนึ่งร้อยยี่สิบห้าบาท"],
    ["ฉันใช้ TypeScriptเวอร์ชัน 2", "ฉันใช้ TypeScript เวอร์ชัน สอง"],
    ["จะ-จะ-จะบอกว่าไม่ได้รอเธอ 15 นาทีหรอก!", "จะ… จะ… จะบอกว่าไม่ได้รอเธอ สิบห้า นาทีหรอก!"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(speechText(input, "th"), expected, input);
    assert.equal(speechText(speechText(input, "th"), "th"), expected, `idempotent: ${input}`);
  }
  assert.equal(speechText("Price 1,250 baht, 15%", "en"), "Price 1,250 baht, 15%");
  assert.equal(speechText("ใช้ UTF-8 และ v2.1", "th"), "ใช้ UTF-8 และ v2.1");
});

test("Markdown stage directions and links do not become spoken instructions", () => {
  assert.equal(speechText("# **ไม่ใช่ซะหน่อย**\n*กอดอก* ด- ด- เดี๋ยว! [ถอนหายใจ] [อ่านนี่](https://example.com) ![รูป](https://example.com/a.png) www.example.com\n```js\nthrow 123\n```", "th"), "ไม่ใช่ซะหน่อย ด… ด… เดี๋ยว! อ่านนี่");
  assert.equal(speechText("**ราคา 15 บาท** (ค่า 3.14)", "th"), "ราคา สิบห้าบาท (ค่า สามจุดหนึ่ง สี่)");
});

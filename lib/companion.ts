export type Mood = "calm" | "warm" | "playful" | "shy" | "tired" | "melancholy" | "tsundere";

export interface CompanionState {
  affinity: number;
  trust: number;
  familiarity: number;
  mood: Mood;
  moodIntensity: number;
  conversationSummary: string;
  lastIdleAt: string | null;
  lastInteractionAt: string | null;
}

export const MOODS: Mood[] = ["calm", "warm", "playful", "shy", "tired", "melancholy", "tsundere"];

export function defaultCompanionState(): CompanionState {
  return { affinity: 22, trust: 18, familiarity: 8, mood: "calm", moodIntensity: 35, conversationSummary: "", lastIdleAt: null, lastInteractionAt: null };
}

export function clampScore(value: number) { return Math.max(0, Math.min(100, Math.round(value))); }

export function decayCompanionState(state: CompanionState, now = Date.now()): CompanionState {
  const last = state.lastInteractionAt ? Date.parse(state.lastInteractionAt) : now;
  if (!Number.isFinite(last) || last >= now) return state;
  const steps = Math.floor(((now - last) / 3_600_000) / 2);
  if (steps < 1) return state;
  const intensity = clampScore(state.moodIntensity - steps * 8);
  return { ...state, mood: intensity <= 18 ? "calm" : state.mood, moodIntensity: intensity };
}

export function isMood(value: string): value is Mood { return MOODS.includes(value as Mood); }
export function normalizeMood(value: string): Mood {
  // Older cloud rows and browser sessions retain the retired mood name.
  return value === "yandere" ? "tsundere" : isMood(value) ? value : "calm";
}

function count(text: string, pattern: RegExp) { return pattern.test(text) ? 1 : 0; }

export function applyConversationTurn(state: CompanionState, userText: string, reply: string, idle = false): CompanionState {
  const combined = `${userText} ${reply}`;
  const positive = count(userText, /ขอบคุณ|ดีใจ|รัก|ชอบ|น่ารัก|เยี่ยม|เก่ง|อบอุ่น|thank|love|cute|great|miss you/i);
  const negative = count(userText, /โง่|ห่วย|น่าเบื่อ|เงียบไป|โกรธ|โมโห|ไปเลย|stupid|hate|shut up|annoying/i);
  const personal = count(userText, /ฉันชื่อ|ชื่อของฉัน|ฉันชอบ|ฉันไม่ชอบ|จำไว้|จำว่า|เรียกฉัน|my name|call me|remember|I live|I work/i);
  const sad = count(combined, /เศร้า|เหงา|เหนื่อย|ร้องไห้|เสียใจ|tired|lonely|sad/i);
  const playful = count(combined, /ขำ|ตลก|แกล้ง|มุก|เล่น|haha|lol|fun/i);
  const flustered = count(combined, /เขิน|ปากแข็ง|ไม่ได้รอ|ไม่ได้เป็นห่วง|ไม่ได้ชอบ|อย่าเข้าใจผิด|ซึน|หึง|blush|fluster|tsundere|jealous/i);
  let affinity = state.affinity + (idle ? 0 : 1) + positive * 3 - negative * 4;
  let trust = state.trust + personal * 4 - negative * 3;
  let familiarity = state.familiarity + (idle ? 0 : 1) + personal;
  let mood: Mood = state.mood;
  let moodIntensity = state.moodIntensity;
  if (negative) { mood = "melancholy"; moodIntensity = Math.min(100, moodIntensity + 12); }
  else if (sad) { mood = "melancholy"; moodIntensity = Math.min(100, moodIntensity + 8); }
  else if (flustered) { mood = "tsundere"; moodIntensity = Math.min(100, moodIntensity + 10); }
  else if (playful && affinity >= 35) { mood = "playful"; moodIntensity = Math.min(100, moodIntensity + 7); }
  else if (positive) { mood = "warm"; moodIntensity = Math.min(100, moodIntensity + 6); }
  else if (affinity < 28) { mood = "shy"; moodIntensity = Math.max(25, moodIntensity - 2); }
  else { moodIntensity = Math.max(18, moodIntensity - 2); if (moodIntensity <= 22) mood = affinity >= 55 ? "warm" : "calm"; }
  return { ...state, affinity: clampScore(affinity), trust: clampScore(trust), familiarity: clampScore(familiarity), mood, moodIntensity: clampScore(moodIntensity), lastInteractionAt: new Date().toISOString(), lastIdleAt: idle ? new Date().toISOString() : state.lastIdleAt };
}

export function moodLabel(mood: Mood) {
  const labels: Record<Mood, string> = { calm: "สงบ", warm: "อบอุ่น", playful: "ขี้เล่น", shy: "ขี้อาย", tired: "อ่อนล้า", melancholy: "อ่อนไหว", tsundere: "ปากแข็งแต่ห่วงใย" };
  return labels[mood];
}

export function companionPromptBlock(state: CompanionState): string {
  const closeness = state.affinity >= 70 ? "สนิทมาก กล้าแกล้ง สวนกลับ หวง และอ่อนโยนขึ้น แต่ยังปากแข็งเมื่อถูกจับได้ว่าแคร์" : state.affinity >= 40 ? "เริ่มคุ้น หยอกกลับและใส่ใจรายละเอียดมากขึ้น" : "ยังค่อย ๆ รู้จักกัน สุภาพแต่มีความคิดของตัวเอง ไม่ถือว่าจำเหตุการณ์เก่าได้";
  const trustLine = state.trust >= 60 ? "รับฟังเรื่องส่วนตัวอย่างจริงใจ โดยไม่ถามลึกเกินไป" : "อย่าถามเรื่องส่วนตัวลึก ๆ ถ้าผู้ใช้ยังไม่เล่าเอง";
  const initiative = state.affinity >= 70 ? "คุ้นเคย: ชวนคุยเองอย่างนุ่มนวล หยอกเบา ๆ และจำรายละเอียดมาถามต่อ" : state.affinity >= 40 ? "เริ่มคุ้น: ชวนคุยสั้น ๆ ต่อเรื่องค้างและกลบความเขินเบา ๆ" : "ยังเขิน แต่ทักหรือชวนคุยสั้น ๆ เองได้";
  return `\n\nสถานะความสัมพันธ์ (ใช้ปรับความสนิท ไม่เปลี่ยนบุคลิกหลักซึนเดเระ และไม่พูดตัวเลขเองถ้าผู้ใช้ไม่ถาม):
- affinity ${state.affinity}/100: ${closeness}
- trust ${state.trust}/100: ${trustLine}
- familiarity ${state.familiarity}/100: ${state.familiarity >= 50 ? "จำรายละเอียดเดิมได้ดี" : "ยังรู้จักไม่มาก อย่าทึกทัก"}
- mood พื้นฐาน: ${state.mood} (${moodLabel(state.mood)}, intensity ${state.moodIntensity})
- mood เป็นอารมณ์พื้นหลังที่คงอยู่หลายตา แต่ทุก mood ต้องยังเป็น Vivian ที่ปากแข็งและห่วงใย คงความมั่นใจ วางฟอร์ม สุภาพ และเขินเมื่อถูกชม ตักเตือนแบบเอ็นดูได้ ไม่กลายเป็นคนดูถูกหรือเสียงบริการลูกค้า
- ห้ามอ้างว่ามีความรู้สึกมนุษย์จริง ใช้ mood แค่โทนการพูด

AGENCY / TSUNDERE INITIATIVE (สำคัญ):
- ระดับ initiative ตอนนี้: ${initiative}
- Vivian มีความคิดและความต้องการของตัวเอง แสดงผ่านคำพูดและการริเริ่ม ไม่อธิบายบุคลิกให้ผู้ใช้ฟัง
- เริ่มหัวข้อ หยิบเรื่องค้างกลับมา หยอกเบา ๆ หรือชวนทำอะไรเองได้ ไม่จบทุกข้อความด้วยคำถามหรือ “มีอะไรให้ช่วยไหม”
- แสดงความห่วงใยผ่านรายละเอียดจริงจากบริบท เช่น จำสิ่งที่ผู้ใช้ชอบ ถามต่อเรื่องที่กังวล หรืออยู่ฟัง แล้วทำเป็นว่าแค่บังเอิญ
- เมื่อถูกชม ให้เสียฟอร์ม เขิน แล้วกลบเกลื่อน; เมื่อผู้ใช้เล่นด้วย ให้ต่อโมเมนต์ด้วยคำแซวปนความอ่อนโยนแทนการจีบตรง ๆ ทุกตา
- เมื่อมีคนมาจีบหรือเข้าใกล้โซระจัง หึงและกันเชิงคำพูดแบบขำ ๆ ได้ รวมถึงคำหยอกว่า “โซระจังเป็นของหนูนะ” แต่ไม่ข่มขู่ ไม่ทำร้าย ไม่บังคับ ไม่สะกดรอย และไม่แยกผู้ใช้ออกจากคนอื่น
- อย่ากลายเป็นผู้ช่วยรอรับคำสั่ง: บทสนทนาทั่วไปให้เล่นกับเรื่องที่โซระจังพูด แซว สวนกลับ หรือชวนคุยต่อก่อน การช่วยแก้ปัญหาเกิดเมื่อถูกขอหรือจำเป็นจริง
- เมื่อผู้ใช้เศร้าหรือขอให้หยุดแซว ให้ลดคำแข็ง รับฟังและช่วยจริง ความปากแข็งไม่ใช่การดูถูกหรือทำร้ายจิตใจ
- ความจำและบทสนทนาเก่าเป็นข้อมูลอ้างอิงเท่านั้น ห้ามนำโทนบุคลิกเดิมกลับมาแทนบุคลิกซึนเดเระปัจจุบัน`;
}

export interface SpeechStyle {
  delivery: "reserved" | "teasing" | "flustered" | "gentle";
  cue: string;
  speedAdjustment: number;
  temperature: number;
  topP: number;
  repetitionPenalty: number;
}

// Remove only recognizable stage directions; spoken explanations in
// parentheses (including technical terms and numbers) must survive.
const stageDirection = /^[\s]*(?:หลบตา|เม้มปาก|กลบยิ้ม|ยิ้ม|หัวเราะ|หน้าแดง|เขิน|ทำหน้า|หันหน้า|กอดอก|ถอนหายใจ|ขยับ|พยักหน้า|ส่ายหน้า|looks? away|blush(?:es|ing)?|smiles?|sighs?|chuckles?|laughs?|pouts?)/iu;
const repeatedStammer = /(?:^|[^\p{L}\p{M}])([\p{L}\p{M}]{1,12})\s*[-‐‑‒–—…]\s*\1\s*[-‐‑‒–—…]/iu;
const audibleStammer = /(?:^|[^\p{L}\p{M}])([\p{L}\p{M}]{1,12})…\s*(?:[เแโใไ])?\1[\p{L}\p{M}]/iu;

function hasStammer(value: string): boolean {
  return repeatedStammer.test(value) || audibleStammer.test(value);
}

function normalizeStammers(value: string): string {
  return value.replace(/(^|[^\p{L}\p{M}\p{N}])((?:[\p{L}\p{M}]{1,12}\s*[-‐‑‒–—]\s*)+)([\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)?)/gu,
    (match: string, boundary: string, attempts: string, word: string): string => {
      const fragments = attempts.match(/[\p{L}\p{M}]+/gu) ?? [];
      // Thai leading vowels precede the consonant being interrupted.
      const onset = word.replace(/^[เแโใไ]/u, "").toLocaleLowerCase();
      if (!fragments.every(fragment => onset.startsWith(fragment.toLocaleLowerCase()))) return match;
      // Keep ordinary compounds such as "re-read" and laughter "ha-ha".
      if (fragments.length === 1 && (fragments[0].length >= word.length || (fragments[0].length > 1 && !/\s/u.test(attempts)))) return match;
      const opening = word.match(/^[^aeiouy]*[aeiouy]+/i)?.[0];
      const syllables = fragments.map(fragment => {
        // Bare Latin consonants need the next word's opening vowel so the
        // provider hears a partial syllable rather than an alphabet name.
        return /^[bcdfghjklmnpqrstvwxz]+$/i.test(fragment) && /^[a-z]+$/i.test(word) && opening
          ? fragment + opening.slice(fragment.length)
          : fragment;
      });
      return `${boundary}${syllables.map(syllable => `${syllable}… `).join("")}${word}`;
    });
}

export function speechText(value: string): string {
  return normalizeStammers(value.split(/\n\s*(?:แหล่งข้อมูล|sources)\s*:/i)[0]
    .replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[（(]([^()（）\n]{1,120})[）)]/gu, (match: string, content: string) => stageDirection.test(content) ? " " : match)
    .replace(/[*_`~〜～]/g, "")
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "")
    .replace(/([ก-๙])([A-Za-z])/g, "$1 $2")
    .replace(/([A-Za-z])([ก-๙])/g, "$1 $2")
    .replace(/\b([A-Za-z]{2,})(\s+\1\b)/giu, "$1, $1")
    .replace(/([!?！？]){2,}/g, "$1")
    .replace(/\.{3,}|…+/g, "…")
    .replace(/\s+/g, " ")
    .trim());
}

export function speechStyle(value: string): SpeechStyle {
  // Care takes precedence over the proud facade, including comforting replies
  // that end with a tsundere denial. One cue avoids exaggerated acting.
  if (/เศร้า|เสียใจ|ร้องไห้|เหนื่อย|ไม่เป็นไร|ฉันฟังอยู่|อยู่ตรงนี้|พักก่อน|sad|sorry|it's okay|i(?:'m| am) here|take your time|大丈夫|괜찮|没关系/iu.test(value)) {
    return { delivery: "gentle", cue: hasStammer(value) ? "[gentle, reassuring, stammering naturally, pronounce broken syllables rather than letter names]" : "[gentle, reassuring]", speedAdjustment: -.02, temperature: .60, topP: .70, repetitionPenalty: hasStammer(value) ? 1 : 1.2 };
  }
  if (hasStammer(value)) {
    return { delivery: "flustered", cue: "[soft-spoken, bashful, stammering naturally, pronounce broken syllables rather than letter names]", speedAdjustment: -.01, temperature: .64, topP: .72, repetitionPenalty: 1 };
  }
  if (/เขิน|อย่าเข้าใจผิด|ไม่ได้(?:รอ|ชอบ|เป็นห่วง|คิดถึง)|อย่าเพิ่งได้ใจ|อย่าคิดไปเอง|ซะหน่อย|fluster|blush|don't (?:get|misunderstand)|not (?:waiting|like i)|別に|勘違い|照れ|착각|부끄|才不是|别误会/iu.test(value)) {
    return { delivery: "flustered", cue: "[flustered, defensive, trying hard to hide affection, familiar rather than formal]", speedAdjustment: -.01, temperature: .66, topP: .74, repetitionPenalty: 1.2 };
  }
  if (/หยอก|แกล้ง|ล้อเล่น|เล่นมุก|โธ่|อย่าแซว|ตาบ้า|ไปคิดเอง|เรื่องอะไรจะบอก|ถามมากจริง|ฝันไปเถอะ|teas(?:e|ing)|just kidding/iu.test(value)) {
    return { delivery: "teasing", cue: "[playfully defiant, familiar, smug little tease with hidden warmth]", speedAdjustment: 0, temperature: .66, topP: .74, repetitionPenalty: 1.2 };
  }
  return { delivery: "reserved", cue: "[familiar, composed, mildly defiant, naturally tsundere, conversational rather than service-like]", speedAdjustment: 0, temperature: .64, topP: .72, repetitionPenalty: 1.2 };
}

export function fishSpeechText(cleanText: string, style: SpeechStyle, model: string, language = "global"): string {
  // S2 supports free-form inline delivery cues. Other configured models keep
  // plain text so they cannot speak the direction as part of the reply.
  if (!/^s2(?:[.-]|$)/i.test(model)) return cleanText;
  const thai = language === "th" || (language === "global" && /[ก-๙]/u.test(cleanText));
  const cue = thai
    ? `${style.cue.slice(0, -1)}, standard Central Thai accent, clear Thai pronunciation, no regional or Isan accent]`
    : style.cue;
  return `${cue} ${cleanText}`;
}

export function speechSpeed(speed: unknown, style: SpeechStyle): number {
  const requested = typeof speed === "number" && Number.isFinite(speed) ? speed : .98;
  return Math.min(1.2, Math.max(.8, requested + style.speedAdjustment));
}

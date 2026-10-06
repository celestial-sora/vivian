export type ToolName = "web_search" | "time" | "weather" | "calculator" | "memory_retrieval";
export type ToolResult = { name: ToolName; ok: boolean; content: string };

const weatherIntent = /อากาศ|ฝน|อุณหภูมิ|พยากรณ์|ร้อน|หนาว|weather|forecast|temperature/i;
const timeIntent = /กี่โมง|กี่นาฬิกา|ตอนนี้เวลา|เวลา(?:ตอนนี้|ปัจจุบัน|เท่าไหร่)|ขอ(?:ดู)?เวลา|เช็[กค]เวลา|วันที่เท่าไหร่|วันอะไร|วันที่วันนี้|วันนี้วันที่|what(?:'s| is)? (?:the )?(?:current )?time|how late is it|time (?:now|zone)|current time|date today|today.?s date|timezone|(?:GMT|UTC)\s*\+\s*7/i;
const calcIntent = /คำนวณ|เท่ากับเท่าไหร่|calculate|เท่าไหร่\s*[0-9]|[0-9]+\s*[\+\-\*x×÷\/]/i;
const memoryIntent = /จำได้ไหม|เคยบอก|ที่เล่าไว้|recall|what did I tell|remember when/i;
export const searchIntent = /(ค้นหา|search|หาให้หน่อย|ข่าว|ล่าสุด|ราคา|current|latest|look up|ออนไลน์|บนเว็บ|ในเน็ต)/i;

const weatherCodes: Record<number, string> = {
  0: "ท้องฟ้าโปร่ง",
  1: "ส่วนมากโปร่ง",
  2: "มีเมฆบางส่วน",
  3: "เมฆมาก",
  45: "หมอก",
  48: "หมอกน้ำแข็ง",
  51: "ฝนปรอยเล็กน้อย",
  61: "ฝนเล็กน้อย",
  63: "ฝนปานกลาง",
  65: "ฝนหนัก",
  71: "หิมะเล็กน้อย",
  80: "ฝนซู่",
  95: "พายุฝนฟ้าคะนอง",
};

export function detectTools(userText: string): ToolName[] {
  const tools: ToolName[] = [];
  if (searchIntent.test(userText)) tools.push("web_search");
  if (timeIntent.test(userText)) tools.push("time");
  if (weatherIntent.test(userText)) tools.push("weather");
  if (calcIntent.test(userText)) tools.push("calculator");
  if (memoryIntent.test(userText)) tools.push("memory_retrieval");
  return tools;
}

export function timeTool(): ToolResult {
  const now = new Date();
  const date = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now);
  const time = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", hour12: false }).format(now);
  return { name: "time", ok: true, content: `เวลาปัจจุบันที่กรุงเทพฯ (Bangkok, Asia/Bangkok, GMT+7 / UTC+07:00): ${date} เวลา ${time} น. เวลานี้แปลงเป็นเวลาไทยแล้ว ห้ามบวก 7 ชั่วโมงซ้ำ` };
}

function extractCity(userText: string) {
  const named = userText.match(/(?:อากาศ|ฝน|weather|forecast).{0,12}(?:ที่|ใน|ที่เมือง|ที่จังหวัด)?\s*([A-Za-zก-๙]{2,30})/i);
  const city = named?.[1]?.trim();
  if (!city || /วันนี้|ตอนนี้|เป็นไง|ไหม|ยังไง|here|now/i.test(city)) return "Bangkok";
  return city;
}

export async function weatherTool(userText: string): Promise<ToolResult> {
  try {
    const city = extractCity(userText);
    const geo = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=th`, { signal: AbortSignal.timeout(2000) });
    const geoData = await geo.json() as { results?: { name: string; latitude: number; longitude: number; country?: string }[] };
    const place = geoData.results?.[0] ?? { name: "Bangkok", latitude: 13.7563, longitude: 100.5018, country: "Thailand" };
    const weather = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,relative_humidity_2m,weather_code&timezone=Asia%2FBangkok`, { signal: AbortSignal.timeout(2000) });
    if (!weather.ok) throw new Error("weather failed");
    const data = await weather.json() as { current?: { temperature_2m?: number; relative_humidity_2m?: number; weather_code?: number } };
    const current = data.current ?? {};
    const condition = weatherCodes[current.weather_code ?? 1] ?? "ไม่ระบุ";
    return { name: "weather", ok: true, content: `${place.name}${place.country ? `, ${place.country}` : ""}: ${current.temperature_2m ?? "?"} C, ความชื้น ${current.relative_humidity_2m ?? "?"}%, ${condition}` };
  } catch (error) {
    console.warn("Weather tool failed", error);
    return { name: "weather", ok: false, content: "โหลดข้อมูลอากาศไม่สำเร็จ ใช้ความรู้ทั่วไปอย่างระวัง" };
  }
}

type TavilySearchResponse = {
  answer?: string;
  results?: Array<{ title?: string; url?: string; content?: string; score?: number }>;
};

export async function webSearchTool(userText: string): Promise<ToolResult> {
  const apiKey = process.env.TAVILY_API_KEY?.trim();
  if (!apiKey) return { name: "web_search", ok: false, content: "TAVILY_API_KEY is not configured" };

  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        query: userText,
        search_depth: "basic",
        max_results: 5,
        include_answer: false,
        include_raw_content: false,
        include_images: false,
      }),
    });

    if (!response.ok) throw new Error(`Tavily returned ${response.status}`);
    const data = await response.json() as TavilySearchResponse;
    const results = (data.results ?? [])
      .filter((item) => item.title && item.url && item.content)
      .slice(0, 5);

    if (!results.length) return { name: "web_search", ok: true, content: "Tavily ไม่พบผลการค้นหาที่เกี่ยวข้อง" };

    const content = results.map((item, index) =>
      `[${index + 1}] ${item.title}\nURL: ${item.url}\n${item.content?.slice(0, 900)}`
    ).join("\n\n");

    return { name: "web_search", ok: true, content: `ผลค้นหาจาก Tavily:\n${content}` };
  } catch (error) {
    console.warn("Tavily search failed", error);
    return { name: "web_search", ok: false, content: "ค้นเว็บผ่าน Tavily ไม่สำเร็จ กรุณาตอบโดยไม่แต่งข้อมูลล่าสุดขึ้นเอง" };
  }
}

function extractExpression(userText: string) {
  const match = userText.replace(/x/gi, "*").replace(/×/g, "*").replace(/÷/g, "/").match(/[\d.+\-*/() ]{3,}/);
  return match?.[0]?.trim() ?? "";
}

export function calculatorTool(userText: string): ToolResult {
  const expression = extractExpression(userText);
  if (!expression || !/^[\d.+\-*/() ]+$/.test(expression)) return { name: "calculator", ok: false, content: "ไม่มีนิพจน์ที่คำนวณได้" };
  try {
    const value = Function(`"use strict"; return (${expression})`)();
    if (typeof value !== "number" || !Number.isFinite(value)) return { name: "calculator", ok: false, content: "ผลลัพธ์ไม่ใช่ตัวเลข" };
    return { name: "calculator", ok: true, content: `${expression.trim()} = ${Number(value.toPrecision(12))}` };
  } catch {
    return { name: "calculator", ok: false, content: "คำนวณไม่สำเร็จ" };
  }
}

export function memoryTool(userText: string, memories: { memory: string; category: string }[]): ToolResult {
  const terms = userText.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((term) => term.length >= 2).slice(0, 8);
  const hits = memories.filter((item) => terms.some((term) => item.memory.toLowerCase().includes(term))).slice(0, 5);
  if (!hits.length) return { name: "memory_retrieval", ok: true, content: "ไม่พบความจำที่ตรงกับคำถามนี้" };
  return { name: "memory_retrieval", ok: true, content: hits.map((item) => `[${item.category}] ${item.memory}`).join("\n") };
}

export async function runTools(userText: string, memories: { memory: string; category: string }[], forceSearch = false, selectedTools?: readonly ToolName[]): Promise<ToolResult[]> {
  const names = selectedTools ? [...selectedTools] : detectTools(userText);
  if (forceSearch && !names.includes("web_search")) names.push("web_search");
  const results: ToolResult[] = [];
  for (const name of names) {
    if (name === "web_search") results.push(await webSearchTool(userText));
    if (name === "time") results.push(timeTool());
    if (name === "weather") results.push(await weatherTool(userText));
    if (name === "calculator") results.push(calculatorTool(userText));
    if (name === "memory_retrieval") results.push(memoryTool(userText, memories));
  }
  return results;
}

export function toolsPromptBlock(results: ToolResult[]) {
  if (!results.length) return "";
  return `\n\nข้อมูลหลังฉากที่ Vivian รู้ในตานี้ (Vivian เลือกเองว่าจะพูดถึงส่วนไหน; ถ้าพูดข้อเท็จจริงให้ยึดข้อมูลนี้และอย่าแต่งตัวเลขใหม่):\n${results.map((item) => `- ${item.name}: ${item.content}`).join("\n")}`;
}

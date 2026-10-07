"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { scheduleBackgroundWork } from "@/lib/startup-background";
import { authFetch } from "@/lib/auth/fetch";
import { DEFAULT_SPEAKING_SPEED, validSpeakingSpeed } from "@/lib/voice-preferences";

export function useVoicePreferences() {
  const [speed, setSpeed] = useState(DEFAULT_SPEAKING_SPEED);
  const [notice, setNotice] = useState("");
  const revision = useRef(0);
  const queue = useRef(Promise.resolve());
  const pending = useRef(0);
  const alive = useRef(false);
  const refresh = useCallback(async () => {
    if (pending.current) return;
    const version = revision.current;
    try {
      const response = await authFetch("/api/voice/preferences", { cache: "no-store", signal: AbortSignal.timeout(9000) });
      if (!response.ok) throw new Error();
      const data = await response.json();
      if (!validSpeakingSpeed(data.speakingSpeed)) throw new Error();
      if (alive.current && version === revision.current && !pending.current) {
        setSpeed(data.speakingSpeed);
        setNotice("");
      }
    } catch { if (alive.current && version === revision.current) setNotice("โหลดค่ากลางไม่ได้ กรุณาลองใหม่"); }
  }, []);
  useEffect(() => {
    alive.current = true;
    const cancelInitial = scheduleBackgroundWork(() => { if (alive.current) void refresh(); });
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", visible);
    document.addEventListener("visibilitychange", visible);
    const timer = window.setInterval(visible, 15000);
    return () => {
      cancelInitial();
      alive.current = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", visible);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [refresh]);
  const save = useCallback((value: number) => {
    if (!validSpeakingSpeed(value)) return;
    const version = ++revision.current;
    setSpeed(value);
    setNotice("กำลังบันทึก…");
    pending.current++;
    // Serialize writes so rapid slider changes cannot commit out of order.
    queue.current = queue.current.then(async () => {
      if (version !== revision.current) { pending.current--; return; }
      try {
        const response = await authFetch("/api/voice/preferences", {
          method: "PATCH", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ speakingSpeed: value }), signal: AbortSignal.timeout(9000), keepalive: true,
        });
        if (!response.ok) throw new Error();
        if (alive.current && version === revision.current) setNotice("บันทึกแล้ว · ใช้ร่วมกันทุกบัญชี");
      } catch { if (alive.current && version === revision.current) setNotice("บันทึกไม่สำเร็จ กรุณาลองใหม่"); }
      finally { pending.current--; }
    });
  }, []);
  return { speed, save, notice, refresh };
}

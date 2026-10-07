# Thai TTS preparation and verification

Only `/api/tts` prepares speech; the browser retains the original chat reply. STT and chat persona rules are unchanged. The browser posts text, speed and selected language, then plays MP3 at volume 1. Desktop connects its analyser directly to the audio destination; iOS uses native playback. No gain, volume or loudness settings were changed.

## Audit (2026-10-07)

Baseline main: `1412f36`. Default model remains `s2.1-pro-free`; `FISH_AUDIO_MODEL` can override it. `reference_id` remains `FISH_AUDIO_VOICE_ID`. No production credentials or reference recordings were available in this workspace, so the deployed override and source voice's accent could not be inspected.

Verified against the official [Fish documentation](https://github.com/fishaudio/docs/tree/b5d3d29b6c35627edf1c4b7c66fda382e4f85d28):

- [TTS OpenAPI](https://github.com/fishaudio/docs/blob/b5d3d29b6c35627edf1c4b7c66fda382e4f85d28/api-reference/openapi.json), `TTSRequest` / `ProsodyControl`: all existing request parameters are documented, including repetition penalty, chunk continuity and `normalize_loudness`.
- [Models overview](https://github.com/fishaudio/docs/blob/b5d3d29b6c35627edf1c4b7c66fda382e4f85d28/developer-guide/models-pricing/models-overview.mdx): S2 automatically detects language; `/v1/tts` has no language-lock field. S1's listed languages do not include Thai. S2.1 free and paid use the same model quality, so switching to paid alone is not evidence of an accent fix.
- Bracket cues are ordinary text with learned acoustic associations. Their delivery effect is not guaranteed. The old long English cue, including negative Isan instructions, was a possible interference source, not a proven audible cause. Thai cues are now short, positive and enabled only for the three documented S2 model names.
- Fish normalization targets English and Chinese. The previous code disabled it but sent raw numbers: there was no deterministic Thai reading. Preparation now handles Thai counts, baht/satang, clock time, named dates/years and explicit `วันที่ d/m/yyyy`, decimal digits, percentages and domestic phone digits. Gregorian years are not silently converted to Buddhist years. English language selection keeps numbers unchanged. Latin identifiers such as UTF-8 and v2.1 survive.

Markdown markers, image links, fenced code, URLs and recognizable stage directions are removed from speech, while link labels, ordinary parenthetical explanations, dialogue and stammer attempts survive. Existing style selection, speed adjustments and repetition penalty for stammers are retained.

## Listening still required

Unit tests verify text and the actual mocked HTTP payload, not pronunciation, accent or identity. This environment has no configured Fish credentials and no listening verification was performed. Test with the existing reference first, keeping `volume: 0`, `normalize_loudness: true`, MP3 settings and client volume 1 fixed.

Listen to every regression sentence in `tests/speech.test.mjs`, plus Thai/English code switching and stammering. Compare old and new cues, and a plain-text control, with the same voice/model/settings. Check that cues are not spoken, every digit is present, time/date/currency meanings survive, Central Thai pronunciation is natural, and Vivian still sounds like herself. Repeat samples because generation is stochastic. Test iOS native playback and desktop playback.

If the regional accent persists, inspect the existing reference recording and its transcript before attributing the problem to the model. A possible next step is a clean Central Thai recording from the same speaker, with an accurate transcript and comparable emotional delivery, evaluated as a separate candidate before replacing the primary voice. A pronunciation dictionary can target confirmed recurring word errors; it is not an accent guarantee. Neither reference replacement nor model replacement is included in this change.

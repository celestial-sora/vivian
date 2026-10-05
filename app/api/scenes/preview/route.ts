import { sceneApi } from "@/lib/scene-api";
import { normalizeSceneImage, readSceneInput } from "@/lib/scene-images";
import { SceneError } from "@/lib/scenes";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return sceneApi(request, async () => {
    const input = await readSceneInput(request);
    if (!input.bytes || !input.mime) throw new SceneError("Enter an image URL.");
    const { thumbnail } = await normalizeSceneImage(input.bytes, input.mime);
    return new Response(new Uint8Array(thumbnail), { headers: { "Content-Type": "image/webp", "X-Content-Type-Options": "nosniff" } });
  });
}

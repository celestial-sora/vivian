import { sceneApi } from "@/lib/scene-api";
import { getSceneImage } from "@/lib/scene-store";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return sceneApi(request, async (db, userId) => {
    const image = await getSceneImage(db, userId, (await context.params).id, new URL(request.url).searchParams.get("thumbnail") === "1");
    return new Response(image, {
    headers: { "Content-Type": image.type, "Cache-Control": "private, max-age=0, must-revalidate", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline", Vary: "Cookie, Authorization" },
    });
  });
}

import { cloudApi } from "@/lib/cloud-api";
import { cloudModelParts } from "@/lib/cloud-store";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return cloudApi(request, async (db, userId) => Response.json(await cloudModelParts(db, userId, (await context.params).id, Number(new URL(request.url).searchParams.get("first")))));
}

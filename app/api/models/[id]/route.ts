import { cloudApi } from "@/lib/cloud-api";
import { cloudModelDownload, finishCloudModel, removeCloudObject } from "@/lib/cloud-store";
import { StorageError } from "@/lib/cloud-storage";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return cloudApi(request, async (db, userId) => Response.json(await cloudModelDownload(db, userId, (await context.params).id)));
}
export async function POST(request: Request, context: Context) {
  return cloudApi(request, async (db, userId) => Response.json(await finishCloudModel(db, userId, (await context.params).id)));
}
export async function DELETE(request: Request, context: Context) {
  return cloudApi(request, async (db, userId) => {
    try { await removeCloudObject(db, userId, (await context.params).id); }
    catch (error) { if (!(error instanceof StorageError) || error.status !== 404) throw error; }
    return Response.json({ deleted: true });
  });
}

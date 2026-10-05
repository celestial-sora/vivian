import { cloudApi } from "@/lib/cloud-api";
import { getStorageStatus } from "@/lib/storage-status-store";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return cloudApi(request, async (db) => Response.json(await getStorageStatus(db)));
}

import { cloudApi } from "@/lib/cloud-api";
import { beginCloudModel, cloudModels } from "@/lib/cloud-store";
import { storageJson } from "@/lib/cloud-storage";
export const runtime = "nodejs";
export async function GET(request: Request) {
  return cloudApi(request, async (db, userId) => Response.json(await cloudModels(db, userId)));
}
export async function POST(request: Request) {
  return cloudApi(request, async (db, userId) => Response.json(await beginCloudModel(db, userId, await storageJson(request)), { status: 201 }));
}

import { redirect } from "next/navigation";
import { getAuthAccess } from "@/lib/auth/server";
import Companion from "./companion";

export const dynamic = "force-dynamic";

export default async function Home(): Promise<React.JSX.Element> {
  const { user, error } = await getAuthAccess();
  if (error) {
    const reason = error.status === 403 ? "access_denied" : error.status === 503 ? "auth_unavailable" : "";
    redirect(reason ? `/login?error=${reason}` : "/login");
  }
  return <Companion accountEmail={user.email ?? ""} accountId={user.id} />;
}

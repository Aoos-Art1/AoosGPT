import { redirect } from "next/navigation";
import { AdminConsole } from "@/components/admin-console";
import { getSession, requireAdmin } from "@/lib/server/auth";
export const dynamic = "force-dynamic";
export default async function AdminPage() { const existing = await getSession(); if (!existing) redirect("/login?portal=admin"); if (existing.platformRole !== "super_admin" || existing.portal !== "admin") redirect("/app/dashboard"); const session = await requireAdmin(); return <AdminConsole session={session} />; }

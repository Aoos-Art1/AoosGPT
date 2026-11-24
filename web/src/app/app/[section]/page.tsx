import { notFound, redirect } from "next/navigation";
import { Workspace } from "@/components/workspace";
import { isSection } from "@/lib/navigation";
import { getSession, requireTenant } from "@/lib/server/auth";
export const dynamic = "force-dynamic";
export default async function WorkspacePage({ params, searchParams }: { params: Promise<{ section: string }>; searchParams: Promise<{ conversation?: string }> }) {
  const { section } = await params;
  if (!isSection(section)) notFound();
  const existing = await getSession();
  if (!existing) redirect("/login");
  if (existing.portal === "admin") redirect("/admin");
  const session = await requireTenant();
  const { conversation } = await searchParams;
  return <Workspace section={section} session={session} initialConversationId={conversation} />;
}

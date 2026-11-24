import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
export const metadata: Metadata = { title: "قبول الدعوة", referrer: "no-referrer" };
export default async function InvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) { const { token } = await searchParams; return <AuthForm token={token || ""} />; }

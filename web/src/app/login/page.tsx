import type { Metadata } from "next";
import { AuthForm } from "@/components/auth-form";
export const metadata: Metadata = { title: "تسجيل الدخول" };
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ portal?: string }> }) { const { portal } = await searchParams; return <AuthForm initialPortal={portal === "admin" || portal === "individual" ? portal : "company"} />; }

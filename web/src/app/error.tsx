"use client";
import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui";
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) { return <main className="page-error"><h1>تعذّر فتح الصفحة الآن</h1><p>أعد المحاولة، أو ارجع إلى تسجيل الدخول إذا انتهت جلستك.</p><div className="flex justify-center gap-3"><Button onClick={reset}><RotateCcw size={16} />أعد المحاولة</Button><Link href="/login" className="button button-secondary">تسجيل الدخول</Link></div></main>; }

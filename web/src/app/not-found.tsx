import Link from "next/link";
import { Compass } from "lucide-react";
export default function NotFound() { return <main className="page-error"><Compass className="mx-auto text-emerald" size={35} /><h1>هذه الصفحة غير موجودة</h1><p>قد يكون الرابط تغيّر. لنعد إلى البداية.</p><Link href="/" className="button button-primary mx-auto">الصفحة الرئيسية</Link></main>; }

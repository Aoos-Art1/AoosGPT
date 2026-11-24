"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpLeft, Building2, Eye, EyeOff, LockKeyhole, ShieldCheck, UserRound } from "lucide-react";
import type { Portal } from "@/lib/contracts";
import { api, errorMessage } from "@/lib/client";
import { Brand, Button, Notice } from "./ui";
import { SaudOrb } from "./orb";

type TenantChoice = { id: string; name: string; kind: string; role: string };
type LoginResult = { redirectTo: string; requiresTenantSelection?: false } | { requiresTenantSelection: true; tenants: TenantChoice[] };

export function AuthForm({ initialPortal = "company", token }: { initialPortal?: Portal; token?: string }) {
  const router = useRouter();
  const [portal, setPortal] = useState<Portal>(initialPortal);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tenants, setTenants] = useState<TenantChoice[]>([]);
  const [tenantId, setTenantId] = useState("");
  const invite = token !== undefined;
  const invalidInvite = invite && !/^[A-Za-z0-9_-]{43}$/.test(token);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const result = await api<LoginResult>(invite ? "/api/auth/invite/accept" : "/api/auth/login", { method: "POST", body: JSON.stringify(invite ? { token, name, password } : { email, password, portal, ...(tenantId ? { tenantId } : {}) }) });
      if (result.requiresTenantSelection) { setTenants(result.tenants); setTenantId(result.tenants[0]?.id || ""); return; }
      router.push(result.redirectTo); router.refresh();
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
  }
  return <main className="auth-page"><div className="auth-form-side"><Brand /><div className="auth-form-wrap"><span className="eyebrow">{invite ? "دعوتك إلى مساحة سعود" : "حيّاك في سعود"}</span><h1>{invite ? "مساحة جديدة، وبداية أوضح" : portal === "admin" ? "دخول إدارة المنصة" : "نكمل إنجازاتك، معًا"}</h1><p>{invite ? "أكمل معلوماتك للانضمام إلى مساحة العمل التي دُعيت إليها." : "اختر بوابتك وسجّل الدخول إلى مساحة عملك."}</p>{!invite && <div className="portal-tabs" role="tablist" aria-label="بوابة الدخول">{([{ id: "individual", label: "الأفراد", icon: UserRound }, { id: "company", label: "الشركات", icon: Building2 }, { id: "admin", label: "الإدارة", icon: ShieldCheck }] as const).map((item) => <button role="tab" aria-selected={portal === item.id} key={item.id} onClick={() => { setPortal(item.id); setTenants([]); setTenantId(""); setError(""); }}><item.icon size={14} />{item.label}</button>)}</div>}{invalidInvite ? <Notice kind="error">رابط الدعوة غير مكتمل أو غير صالح. اطلب من مسؤول المنصة رابط الدعوة الصحيح.</Notice> : <form className="auth-form" onSubmit={submit}>{invite ? <label className="label">الاسم<input className="field" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required maxLength={120} placeholder="اسمك الكامل" /></label> : <label className="label">البريد الإلكتروني<input className="field field-ltr" type="email" value={email} onChange={(event) => { setEmail(event.target.value); if (tenants.length) { setTenants([]); setTenantId(""); } }} autoComplete="email" required maxLength={254} placeholder="name@company.sa" /></label>}<label className="label">كلمة المرور<span className="password-wrap"><input className="field field-ltr" type={visible ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={invite ? "new-password" : "current-password"} required minLength={invite ? 15 : 1} maxLength={invite ? 128 : 512} placeholder={invite ? "١٥ حرفًا على الأقل للحساب الجديد" : "أدخل كلمة المرور"} /><button type="button" aria-label={visible ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"} onClick={() => setVisible((show) => !show)}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></span>{invite && <small>إذا كان لديك حساب، استخدم كلمة مروره الحالية. للحساب الجديد اختر كلمة مرور من ١٥ إلى ١٢٨ حرفًا.</small>}</label>{tenants.length > 0 && <label className="label">اختر مساحة العمل<select className="field" value={tenantId} onChange={(event) => setTenantId(event.target.value)} required>{tenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select><small>لديك أكثر من عضوية. حدّد المساحة التي تريد دخولها.</small></label>}{error && <Notice kind="error">{error}</Notice>}<Button busy={busy}>{invite ? "قبول الدعوة والدخول" : tenants.length ? "الدخول إلى المساحة" : "تسجيل الدخول"}<ArrowUpLeft size={17} /></Button></form>}<p className="auth-help">{invite ? <Link href="/login">لديك حساب وتريد تسجيل الدخول؟</Link> : <>الحسابات متاحة بالدعوة من مسؤول المنصة.<br />{portal === "admin" && <>بوابة الإدارة مخصصة للمسؤولين المعتمدين فقط.<br /></>}<Link href="/preview/dashboard">استكشف الواجهة في المعاينة التوضيحية</Link></>}</p></div><p className="flex items-center gap-2 text-[10px] text-[#688472]"><LockKeyhole size={12} />معلومات الدخول خاصة بك. لا تشارك كلمة مرورك.</p></div><aside className="auth-visual"><div className="auth-orb"><SaudOrb /></div><h2>كل إجراء أوضح.<br /><span>وكل خطوة، أقرب للإنجاز.</span></h2><p>مساحة تجمع أدوات العمل والمعرفة والمتابعة، لتمنح التفاصيل مكانها، وتمنحك وقتك.</p><div className="auth-trust"><span><ShieldCheck size={13} />صلاحيات لكل مساحة</span><span><LockKeyhole size={13} />ذاكرة تحت تحكّمك</span></div></aside></main>;
}

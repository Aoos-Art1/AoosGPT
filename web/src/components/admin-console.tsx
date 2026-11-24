"use client";

import { PendingInvitations } from "./pending-invitations";
import { AdminDirectory } from "./admin-directory";
import type { AdminTenant, AdminUser } from "@/lib/admin-contracts";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Building2, Copy, KeyRound, LogOut, Plus, RefreshCw, ShieldCheck, UserRound, UsersRound } from "lucide-react";
import type { SessionContext, TenantKind, TenantRole } from "@/lib/contracts";
import { api, errorMessage, number, shortDate } from "@/lib/client";
import { Badge, Brand, Button, CardHeading, Notice, SectionHeading, Toast } from "./ui";

type Overview = { users: AdminUser[]; tenants: AdminTenant[]; stats: { users: number; tenants: number; activeTenants: number; pendingInvitations: number } };

export function AdminConsole({ session }: { session: SessionContext }) {
  const router = useRouter();
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [selectedTenant, setSelectedTenant] = useState<AdminTenant | null>(null);
  const [notice, setNotice] = useState<{ message: string; error?: boolean } | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({ email: "", name: "", tenantName: "", kind: "company" as TenantKind, role: "owner" as TenantRole, tenantId: "" });
  const [invitation, setInvitation] = useState<{ inviteUrl: string; invitation: { email: string; expiresAt: string; tenantName: string } } | null>(null);
  const refresh = useCallback(async () => { const result = await api<Overview>("/api/admin"); setData(result); setRevision((value) => value + 1); setError(""); }, []);
  useEffect(() => { let active = true; api<Overview>("/api/admin").then((result) => { if (active) setData(result); }).catch((failure) => { if (active) setError(errorMessage(failure)); }); return () => { active = false; }; }, []);
  async function update(path: string, payload: unknown) {
    setBusy(path);
    try { await api(path, { method: "PATCH", body: JSON.stringify(payload) }); await refresh(); setNotice({ message: "حُفظ التغيير الإداري" }); }
    catch (failure) { setNotice({ message: errorMessage(failure), error: true }); }
    finally { setBusy(null); }
  }
  async function createInvite(event: FormEvent) {
    event.preventDefault(); setBusy("invite");
    try {
      const { tenantId, tenantName, ...rest } = invite;
      const result = await api<{ inviteUrl: string; invitation: { email: string; expiresAt: string; tenantName: string } }>("/api/admin/invitations", { method: "POST", body: JSON.stringify({ ...rest, ...(tenantId ? { tenantId } : { tenantName }) }) });
      setInvitation(result); await refresh(); setNotice({ message: "أُنشئت الدعوة. انسخ الرابط وشاركه مع صاحب البريد المقصود." });
    } catch (failure) { setNotice({ message: errorMessage(failure), error: true }); }
    finally { setBusy(null); }
  }
  const invitableTenants = [...(data?.tenants || []), ...(selectedTenant && !data?.tenants.some((tenant) => tenant.id === selectedTenant.id) ? [selectedTenant] : [])];
  function inviteMember(tenant: AdminTenant) { setSelectedTenant(tenant); setInviteOpen(true); setInvite((current) => ({ ...current, tenantId: tenant.id, kind: tenant.kind, role: "member" })); window.scrollTo({ top: 0, behavior: "smooth" }); }
  return <main className="admin-layout"><header className="admin-header"><Brand /><div><Badge color="gold"><ShieldCheck size={12} />إدارة المنصة</Badge><span className="text-xs text-muted">{session.displayName}</span><button className="icon-button" aria-label="تسجيل الخروج" onClick={async () => { try { await api("/api/auth/logout", { method: "POST" }); router.push("/login?portal=admin"); router.refresh(); } catch (failure) { setNotice({ message: errorMessage(failure), error: true }); } }}><LogOut size={16} /></button></div></header><SectionHeading title="إدارة مساحات العمل" description="الحسابات والعضويات والخطط، بإشراف المسؤول المعتمد." action={<Button onClick={() => setInviteOpen((open) => !open)}><Plus size={16} />{inviteOpen ? "إغلاق الدعوة" : "دعوة مستخدم"}</Button>} />{error && <div className="mb-6 stack"><Notice kind="error">{error}</Notice><Button variant="secondary" onClick={() => refresh().catch((failure) => setError(errorMessage(failure)))}><RefreshCw size={15} />إعادة التحميل</Button></div>}{inviteOpen && <section className="card card-pad mb-6"><CardHeading title="إنشاء دعوة" description="أنشئ مساحة بمالك جديد، أو أضف عضوًا إلى مساحة شركة موجودة. الدعوة لا تمنح صلاحية إدارة المنصة." /><form onSubmit={createInvite}><div className="form-grid"><label className="label">اسم المستخدم<input className="field" value={invite.name} onChange={(event) => setInvite({ ...invite, name: event.target.value })} required maxLength={120} /></label><label className="label">البريد الإلكتروني<input className="field field-ltr" type="email" value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} required maxLength={254} /></label><label className="label">مساحة العمل<select className="field" aria-label="مساحة العمل" value={invite.tenantId} onChange={(event) => { const tenant = invitableTenants.find((item) => item.id === event.target.value); setInvite({ ...invite, tenantId: event.target.value, kind: tenant?.kind || "company", role: tenant ? "member" : "owner" }); }}><option value="">إنشاء مساحة جديدة</option>{invitableTenants.filter((tenant) => tenant.kind === "company" && tenant.status === "active").map((tenant) => <option value={tenant.id} key={tenant.id}>{tenant.name}</option>)}</select><small>للعثور على مساحة أخرى، ابحث عنها في قائمة مساحات العمل واختر «دعوة عضو».</small></label>{invite.tenantId ? <label className="label">صلاحية العضوية<select className="field" value={invite.role} onChange={(event) => setInvite({ ...invite, role: event.target.value as TenantRole })}><option value="member">عضو</option><option value="viewer">مشاهد</option><option value="admin">مسؤول المساحة</option><option value="owner">مالك</option></select></label> : <><label className="label">نوع المساحة<select className="field" value={invite.kind} onChange={(event) => setInvite({ ...invite, kind: event.target.value as TenantKind })}><option value="company">شركة</option><option value="individual">فرد</option></select></label><label className="label full">اسم المساحة الجديدة<input className="field" value={invite.tenantName} onChange={(event) => setInvite({ ...invite, tenantName: event.target.value })} required maxLength={160} /><small>يصبح المدعو مالك هذه المساحة، دون صلاحيات على المساحات الأخرى.</small></label></>}</div><div className="form-actions"><Button busy={busy === "invite"}><KeyRound size={15} />إنشاء رابط الدعوة</Button></div></form>{invitation && <div className="mt-6"><Notice kind="success">دعوة إلى {invitation.invitation.tenantName} للبريد {invitation.invitation.email}، تنتهي في {shortDate(invitation.invitation.expiresAt)}. لم يتم إرسال بريد إلكتروني تلقائيًا.</Notice><div className="invite-link">{invitation.inviteUrl}</div><Button variant="secondary" onClick={async () => { try { await navigator.clipboard.writeText(invitation.inviteUrl); setNotice({ message: "نُسخ رابط الدعوة" }); } catch { setNotice({ message: "تعذّر النسخ. حدّد الرابط وانسخه يدويًا.", error: true }); } }}><Copy size={14} />نسخ الرابط</Button></div>}</section>}
    {!data && !error ? <div className="stack" role="status"><div className="loading-pulse h-32" /><div className="loading-pulse h-64" /><span className="screen-reader-only">جارٍ تحميل بيانات الإدارة...</span></div> : data && <><div className="metric-grid">{[{ title: "المستخدمون", value: data.stats.users, icon: UsersRound }, { title: "مساحات العمل", value: data.stats.tenants, icon: Building2 }, { title: "المساحات النشطة", value: data.stats.activeTenants, icon: ShieldCheck }, { title: "دعوات قيد الانتظار", value: data.stats.pendingInvitations, icon: UserRound }].map((metric) => <article key={metric.title} className="metric-card"><div className="metric-header"><span>{metric.title}</span><span className="metric-icon"><metric.icon size={17} /></span></div><div className="metric-value"><strong>{number(metric.value)}</strong></div></article>)}</div><AdminDirectory revision={revision} sessionUserId={session.userId} busy={!!busy} update={update} onInvite={inviteMember} /></>}
    {data && <PendingInvitations revision={revision} onChange={refresh} />}
    <Toast notice={notice} dismiss={() => setNotice(null)} /><footer className="page-footer"><span>إدارة AoosGPT — القرارات الإدارية للمشغّل المعتمد.</span><span>الحسابات والعضويات مستقلة عن إعدادات الذكاء الاصطناعي.</span></footer>
  </main>;
}

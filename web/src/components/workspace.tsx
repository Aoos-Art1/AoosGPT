"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { ArrowUpLeft, Bell, Building2, Calculator, Check, ChevronLeft, CircleHelp, FileText, Globe2, History, LayoutDashboard, LockKeyhole, LogOut, Menu, Search, Settings2, ShieldCheck, Sparkles, UsersRound, X, type LucideIcon } from "lucide-react";
import type { Section, TenantSession, WorkspaceData } from "@/lib/contracts";
import { NAVIGATION, sectionInfo } from "@/lib/navigation";
import { api, errorMessage } from "@/lib/client";
import { readDemo, updateDemo } from "@/lib/demo";
import { WorkspaceContext } from "./workspace-context";
import { Brand, Button, Notice, Toast } from "./ui";
import { Dashboard } from "./workspace/dashboard";
import { Company } from "./workspace/company";
import { Letters } from "./workspace/letters";
import { Calculators, Hiring } from "./workspace/calculators";
import { Compliance, Platforms } from "./workspace/resources";
import { WorkspaceSettings } from "./workspace/settings";
import { Assistant, ConversationHistory } from "./workspace/assistant";

const icons: Record<Section, LucideIcon> = { dashboard: LayoutDashboard, assistant: Sparkles, history: History, letters: FileText, calculators: Calculator, compliance: ShieldCheck, hiring: UsersRound, platforms: Globe2, company: Building2, settings: Settings2 };

export function Workspace({ section, session = null, demo = false, initialConversationId }: { section: Section; session?: TenantSession | null; demo?: boolean; initialConversationId?: string }) {
  const router = useRouter();
  const [data, setData] = useState<WorkspaceData | null>(() => demo ? readDemo() : null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ message: string; error?: boolean } | null>(null);
  const notify = useCallback((message: string, isError = false) => setNotice({ message, error: isError }), []);
  const refresh = useCallback(async () => {
    if (demo) { setData(readDemo()); return; }
    setData(await api<WorkspaceData>("/api/workspace"));
  }, [demo]);

  useEffect(() => {
    if (demo) return;
    let mounted = true;
    api<WorkspaceData>("/api/workspace").then((next) => { if (mounted) { setData(next); setError(""); } }).catch((failure) => { if (mounted) setError(errorMessage(failure)); });
    return () => { mounted = false; };
  }, [demo]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6500);
    return () => clearTimeout(timer);
  }, [notice]);

  const mutate = useCallback(async (path: string, method: string, payload: unknown, update: (current: WorkspaceData) => WorkspaceData, success = "تم حفظ التغييرات") => {
    setBusy(path);
    try {
      if (demo) setData(updateDemo(update(readDemo())));
      else { await api(path, { method, ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) }); await refresh(); }
      notify(demo ? `${success} في المعاينة المؤقتة` : success);
      return true;
    } catch (failure) { notify(errorMessage(failure), true); return false; }
    finally { setBusy(null); }
  }, [demo, notify, refresh]);

  async function logout() {
    if (demo) { router.push("/login"); return; }
    try { await api("/api/auth/logout", { method: "POST" }); router.push("/login"); router.refresh(); }
    catch (failure) { notify(errorMessage(failure), true); }
  }

  const base = demo ? "/preview" : "/app";
  const sections: Record<Section, ReactNode> = { dashboard: <Dashboard />, assistant: <Assistant key={initialConversationId || "new"} initialConversationId={initialConversationId} />, history: <ConversationHistory />, letters: <Letters />, calculators: <Calculators />, compliance: <Compliance />, hiring: <Hiring />, platforms: <Platforms />, company: <Company />, settings: <WorkspaceSettings /> };

  return <Shell section={section} base={base} demo={demo} userName={demo ? "منصور" : session?.displayName || ""} tenantName={data?.profile.name || session?.tenantName || "مساحة العمل"} onLogout={logout}>
    {error ? <div className="stack"><Notice kind="error">{error}</Notice><Button variant="secondary" onClick={() => { setError(""); refresh().catch((failure) => setError(errorMessage(failure))); }}>إعادة المحاولة</Button><Link href="/login" className="arrow-link">العودة لتسجيل الدخول <ArrowUpLeft size={16} /></Link></div> : !data ? <WorkspaceSkeleton /> : <WorkspaceContext.Provider value={{ data, demo, session, base, canWrite: demo || (!!session && session.tenantRole !== "viewer"), busy, refresh, notify, mutate }}><motion.div key={section} className="workspace-enter" initial={false} animate={{ opacity: 1, y: 0 }} transition={{ duration: .25 }}>{sections[section]}</motion.div></WorkspaceContext.Provider>}
    <Toast notice={notice} dismiss={() => setNotice(null)} />
  </Shell>;
}

function Shell({ children, section, base, demo, userName, tenantName, onLogout }: { children: ReactNode; section: Section; base: string; demo: boolean; userName: string; tenantName: string; onLogout: () => void }) {
  const [mobile, setMobile] = useState(false);
  const [search, setSearch] = useState(false);
  const [query, setQuery] = useState("");
  const searchInput = useRef<HTMLInputElement>(null);
  const searchDialog = useRef<HTMLDivElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function keyboard(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setSearch((open) => !open); }
      if (event.key === "Escape") { setSearch(false); setMobile(false); }
    }
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, []);
  useEffect(() => {
    if (!search) return;
    const trigger = searchButton.current;
    searchInput.current?.focus();
    function trap(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const items = searchDialog.current?.querySelectorAll<HTMLElement>("a[href],button,input");
      if (!items?.length) return;
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1].focus(); }
      if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0].focus(); }
    }
    document.addEventListener("keydown", trap);
    return () => { document.removeEventListener("keydown", trap); trigger?.focus(); };
  }, [search]);
  const closeSearch = () => { setSearch(false); setQuery(""); };

  return <div className="app-shell">
    <a className="skip-link" href="#main-content">انتقل إلى المحتوى</a>
    {mobile && <button aria-label="إغلاق القائمة" className="sidebar-backdrop" onClick={() => setMobile(false)} />}
    <aside className={`sidebar ${mobile ? "open" : ""}`} aria-label="القائمة الرئيسية">
      <div className="sidebar-brand"><Brand href={`${base}/dashboard`} /></div>
      <Link className="workspace-picker" href={`${base}/company`} onClick={() => setMobile(false)}><span className="workspace-avatar"><Building2 size={18} /></span><span><strong>{tenantName}</strong><small>{demo ? "مساحة عمل توضيحية" : "مساحة العمل الخاصة بك"}</small></span><ChevronLeft size={13} className="mr-auto text-[#627e6c]" /></Link>
      <nav className="sidebar-nav">
        {(["workspace", "organization"] as const).map((group) => <div key={group}><p className={`nav-group-label ${group === "organization" ? "second" : ""}`}>{group === "workspace" ? "مساحة العمل" : "إدارة أعمالك"}</p>{NAVIGATION.filter((item) => item.group === group).map((item) => { const Icon = icons[item.id]; return <Link key={item.id} className={`nav-link ${section === item.id ? "active" : ""}`} aria-current={section === item.id ? "page" : undefined} href={`${base}/${item.id}`} onClick={() => setMobile(false)}><Icon size={17} strokeWidth={1.6} /><span>{item.label}</span>{item.id === "assistant" && <span className="nav-badge">AI</span>}</Link>; })}</div>)}
      </nav>
      <div className="sidebar-bottom"><span className="privacy-label"><LockKeyhole size={12} />{demo ? "معاينة منفصلة عن بيانات العملاء" : "مساحة مؤسستك الخاصة"}</span><div className="sidebar-user"><span className="avatar">{userName.trim().slice(0, 1) || "A"}</span><span><strong>{userName || "حسابك"}</strong><small>{demo ? "حساب المعاينة" : "عضو مساحة العمل"}</small></span><button className="icon-button" onClick={onLogout} aria-label={demo ? "تسجيل الدخول" : "تسجيل الخروج"}><LogOut size={15} /></button></div></div>
    </aside>
    <div className="app-main"><header className="topbar"><button className="icon-button mobile-menu" onClick={() => setMobile((open) => !open)} aria-label="فتح القائمة" aria-expanded={mobile}><Menu size={19} /></button><div className="topbar-breadcrumb"><span>مساحة العمل</span><ChevronLeft size={12} /><strong>{sectionInfo(section).label}</strong></div><div className="topbar-actions"><button ref={searchButton} className="search-trigger" onClick={() => setSearch(true)} aria-label="البحث في الأقسام"><Search size={15} /><span>ابحث في AoosGPT...</span><kbd>⌘ K</kbd></button><span className="topbar-divider" /><span className="language-label"><Globe2 size={13} />العربية</span><Link className="icon-button" href={`${base}/dashboard#tasks`} aria-label="المهام والمتابعة"><Bell size={17} /></Link><span className="avatar">{userName.trim().slice(0, 1) || "A"}</span></div></header>
      {demo && <div className="demo-banner"><CircleHelp size={12} /><span>أنت في المعاينة التوضيحية. البيانات افتراضية والتغييرات مؤقتة؛ لا توجد خدمة ذكاء اصطناعي متصلة.</span><Link href="/login">تسجيل الدخول</Link></div>}
      <main id="main-content" className="page-content">{children}{section !== "assistant" && <footer className="page-footer"><span>AoosGPT — وضوح في الإجراءات، مساحة أكبر لإنجاز أعمالك.</span><span><Check size={10} />تُراجع المعلومات النظامية لدى الجهات الرسمية</span></footer>}</main>
    </div>
    <AnimatePresence>{search && <motion.div className="dialog-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.currentTarget === event.target) closeSearch(); }}><div ref={searchDialog} className="search-dialog" role="dialog" aria-modal="true" aria-label="البحث في أقسام AoosGPT"><div className="dialog-search-input"><Search size={19} /><input ref={searchInput} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="إلى أين تود الانتقال؟" aria-label="البحث عن قسم" /><button className="icon-button" onClick={closeSearch} aria-label="إغلاق البحث"><X size={17} /></button></div><div className="search-results">{NAVIGATION.filter((item) => `${item.label} ${item.description}`.includes(query)).map((item) => { const Icon = icons[item.id]; return <Link key={item.id} href={`${base}/${item.id}`} onClick={closeSearch}><Icon size={18} /><span>{item.label}<small>{item.description}</small></span><ArrowUpLeft size={15} /></Link>; })}{!NAVIGATION.some((item) => `${item.label} ${item.description}`.includes(query)) && <p className="p-5 text-sm text-muted">لم نجد قسمًا بهذا الاسم.</p>}</div></div></motion.div>}</AnimatePresence>
  </div>;
}

function WorkspaceSkeleton() { return <div className="stack" aria-label="جارٍ تحميل مساحة العمل" role="status"><div className="loading-pulse w-48" /><div className="loading-pulse h-56" /><div className="metric-grid">{[1, 2, 3, 4].map((item) => <div key={item} className="loading-pulse h-32" />)}</div><span className="screen-reader-only">جارٍ تحميل بياناتك...</span></div>; }

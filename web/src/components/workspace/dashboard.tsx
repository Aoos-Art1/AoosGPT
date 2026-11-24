"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { ArrowUpLeft, CalendarDays, Calculator, Check, ClipboardList, FileText, Plus, ShieldCheck, Sparkles, Trash2, TrendingUp, UsersRound } from "lucide-react";
import { number, shortDate } from "@/lib/client";
import { demoId } from "@/lib/demo";
import { PLATFORM_DIRECTORY } from "@/lib/tools";
import { useWorkspace } from "../workspace-context";
import { ArrowLink, Badge, Button, CardHeading, SectionHeading } from "../ui";
import { SaudOrb } from "../orb";

const dateFormatter = new Intl.DateTimeFormat("ar-SA", { calendar: "gregory", weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Riyadh" });
const currentDateSnapshot = () => dateFormatter.format(Date.now());
const serverDateSnapshot = () => "";

function subscribeToDate(onChange: () => void) {
  const interval = window.setInterval(onChange, 60_000);
  window.addEventListener("focus", onChange);
  document.addEventListener("visibilitychange", onChange);
  return () => {
    window.clearInterval(interval);
    window.removeEventListener("focus", onChange);
    document.removeEventListener("visibilitychange", onChange);
  };
}

function CurrentDateLabel() {
  const date = useSyncExternalStore(subscribeToDate, currentDateSnapshot, serverDateSnapshot);
  return <span className="date-label" aria-busy={!date}><CalendarDays size={14} />{date || "التاريخ الحالي"}</span>;
}

export function Dashboard() {
  const { data, base, demo, session, mutate, canWrite, busy } = useWorkspace();
  const [task, setTask] = useState("");
  const saudis = data.employees.filter((employee) => employee.nationality === "saudi").length;
  const share = data.employees.length ? Math.round(saudis / data.employees.length * 100) : 0;
  const activeTasks = data.tasks.filter((item) => item.status === "todo").length;
  const userName = demo ? "منصور" : session?.displayName.split(" ")[0] || "بك";
  async function addTask(event: FormEvent) {
    event.preventDefault();
    const title = task.trim();
    if (!title) return;
    if (await mutate("/api/tasks", "POST", { title }, (current) => ({ ...current, tasks: [...current.tasks, { id: demoId(), title, dueDate: null, status: "todo" }] }), "أُضيفت المهمة")) setTask("");
  }
  const metrics = [
    { title: "إجمالي الموظفين", value: number(data.employees.length), unit: "موظف", note: "في ملف المنشأة", icon: UsersRound },
    { title: "نسبة الموظفين السعوديين", value: number(share), unit: "%", note: "نسبة وصفية من بياناتك", icon: TrendingUp },
    { title: "مهام قيد المتابعة", value: number(activeTasks), unit: "مهام", note: "خطوتك القادمة تبدأ هنا", icon: ClipboardList },
    { title: "خطاباتك المحفوظة", value: number(data.letters.length), unit: "خطاب", note: "جاهزة للمراجعة والتعديل", icon: FileText },
  ];
  const quick = [
    { id: "letters", title: "صياغة خطاب", description: "مسودة رسمية بلمستك", icon: FileText },
    { id: "calculators", title: "حساب مستحقات", description: "أرقام واضحة ومدخلات مرنة", icon: Calculator },
    { id: "hiring", title: "تقدير تكلفة التوظيف", description: "خطط ميزانية فريقك القادم", icon: UsersRound },
    { id: "compliance", title: "مراجعة قائمة المتابعة", description: "رتّب أولويات منشأتك", icon: ShieldCheck },
  ];
  return <>
    <SectionHeading title={`حيّاك الله، ${userName}`} description="كل ما تحتاجه لإدارة أعمالك، في مساحة واحدة." action={<CurrentDateLabel />} />
    <section className="hero-card"><div className="hero-copy"><Badge><Sparkles size={10} />مساعدك في رحلة الأعمال</Badge><h2>خلّ إجراءاتك أوضح،<br /><span>وإنجازك أسرع.</span></h2><p>اسأل سعود، رتّب مستنداتك، وتابع شؤون منشأتك.<br />مساحة عمل واحدة، تعطيك الصورة كاملة.</p><div className="hero-actions"><Link href={`${base}/assistant`} className="button button-primary"><Sparkles size={14} />ابدأ محادثة مع سعود<ArrowUpLeft size={15} /></Link><span className="hero-note"><ShieldCheck size={12} />قراراتك تبدأ بمعلومات واضحة</span></div></div><SaudOrb /></section>
    <div className="metric-grid">{metrics.map((metric) => <article className="metric-card" key={metric.title}><div className="metric-header"><span>{metric.title}</span><span className="metric-icon"><metric.icon size={16} strokeWidth={1.7} /></span></div><div className="metric-value"><strong>{metric.value}</strong><span>{metric.unit}</span></div><div className="metric-footer">{demo && <b>بيانات توضيحية · </b>}{metric.note}</div></article>)}</div>
    <div className="dashboard-grid"><section className="card card-pad"><CardHeading title="من وين نبدأ؟" description="أدوات تختصر عليك خطوات العمل اليومية" /><div className="quick-grid">{quick.map((item) => <Link className="quick-item" href={`${base}/${item.id}`} key={item.id}><span><item.icon size={19} strokeWidth={1.5} /></span><div><h3>{item.title}</h3><p>{item.description}</p></div><ArrowUpLeft size={13} /></Link>)}</div></section>
    <section id="tasks" className="card card-pad"><CardHeading title="على قائمة متابعتك" description="خطوة بخطوة، كل شيء في وقته" action={<Badge color="gold">{number(activeTasks)} مهام</Badge>} /><div className="task-list">{data.tasks.length === 0 && <p className="py-5 text-xs text-muted">مساحتك جاهزة. أضف أول مهمة تود متابعتها.</p>}{data.tasks.map((item) => <div className={`task-row ${item.status === "done" ? "done" : ""}`} key={item.id}><button className={`task-check ${item.status === "done" ? "done" : ""}`} aria-label={`${item.status === "done" ? "إعادة فتح" : "إكمال"} ${item.title}`} aria-pressed={item.status === "done"} disabled={!canWrite || !!busy} onClick={() => { const status = item.status === "done" ? "todo" : "done"; void mutate(`/api/tasks/${item.id}`, "PATCH", { status }, (current) => ({ ...current, tasks: current.tasks.map((task) => task.id === item.id ? { ...task, status } : task) }), status === "done" ? "أُنجزت المهمة" : "أُعيد فتح المهمة"); }}>{item.status === "done" && <Check size={12} strokeWidth={3} />}</button><div><strong>{item.title}</strong>{item.dueDate && <small>{shortDate(item.dueDate)}</small>}</div><button className="icon-button" aria-label={`حذف ${item.title}`} disabled={!canWrite || !!busy} onClick={() => { if (window.confirm("حذف هذه المهمة؟")) void mutate(`/api/tasks/${item.id}`, "DELETE", undefined, (current) => ({ ...current, tasks: current.tasks.filter((task) => task.id !== item.id) }), "حُذفت المهمة"); }}><Trash2 size={12} /></button></div>)}</div>{canWrite && <form className="add-task" onSubmit={addTask}><input className="field" value={task} onChange={(event) => setTask(event.target.value)} maxLength={200} placeholder="أضف مهمة جديدة..." aria-label="عنوان المهمة الجديدة" required /><Button variant="secondary" aria-label="إضافة المهمة" disabled={!!busy}><Plus size={15} /></Button></form>}</section></div>
    <section className="card card-pad dashboard-platforms"><CardHeading title="منصاتك، أقرب لك" description="وصول مباشر إلى الخدمات الحكومية الرسمية" action={<ArrowLink href={`${base}/platforms`}>جميع المنصات</ArrowLink>} /><div className="platform-mini-grid">{PLATFORM_DIRECTORY.slice(0, 4).map((platform) => <a className="platform-mini" href={platform.url} target="_blank" rel="noopener noreferrer" key={platform.id}><span className="platform-symbol">{platform.name.slice(0, 1)}</span><span><strong>{platform.name}</strong><small>{platform.category}</small></span><ArrowUpLeft size={13} /></a>)}</div></section>
    {data.employees.length > 0 && !demo && <p className="mt-4 text-[10px] text-muted">نسبة الموظفين السعوديين وصف لبيانات الموظفين المدخلة، وليست تقييمًا لنطاق المنشأة أو شهادة امتثال.</p>}
  </>;
}

"use client";

import { useState } from "react";
import { ArrowUpLeft, Check, Globe2, Plus, Search, ShieldCheck } from "lucide-react";
import { PLATFORM_DIRECTORY } from "@/lib/tools";
import { number } from "@/lib/client";
import { demoId } from "@/lib/demo";
import { Badge, Button, CardHeading, Notice, SectionHeading } from "../ui";
import { useWorkspace } from "../workspace-context";

const checklist = [
  { id: "registration", title: "مراجعة بيانات وسجلات المنشأة", description: "تحققت من بيانات منشأتي وتواريخ المتابعة التي تخص نشاطها عبر الجهة المختصة.", authority: "وزارة التجارة", url: "https://mc.gov.sa/" },
  { id: "contracts", title: "مراجعة ملفات وعقود الموظفين", description: "راجعت معلومات الموظفين والعقود وما يحتاج إلى تحديث داخل المنشأة.", authority: "منصة قوى", url: "https://www.qiwa.sa/" },
  { id: "insurance", title: "متابعة بيانات التأمينات", description: "راجعت حالة المنشأة وبيانات المشتركين والملاحظات الظاهرة في حساب المنشأة.", authority: "التأمينات الاجتماعية", url: "https://www.gosi.gov.sa/" },
  { id: "tax", title: "متابعة الالتزامات الزكوية والضريبية", description: "راجعت الالتزامات والمواعيد المنطبقة على نشاط منشأتي مع المختص.", authority: "هيئة الزكاة والضريبة والجمارك", url: "https://zatca.gov.sa/" },
  { id: "licenses", title: "مراجعة الرخص المتعلقة بالنشاط", description: "راجعت الرخص والمستندات المتعلقة بمقر المنشأة ونشاطها حسب حالتها.", authority: "منصة بلدي", url: "https://balady.gov.sa/" },
];

export function Compliance() {
  const { data, mutate, busy, canWrite, base } = useWorkspace();
  const [checked, setChecked] = useState<string[]>([]);
  return <><SectionHeading title="متابعة الامتثال" description="قائمة داخلية تساعدك على ترتيب المراجعة ومتابعة ما يحتاج انتباهك." action={<Badge color="gold"><ShieldCheck size={12} />مراجعة ذاتية</Badge>} /><div className="two-columns"><section className="card card-pad"><CardHeading title="قائمة مراجعة المنشأة" description="ضع علامة بعد مراجعتك، وأضف الأمور المعلقة إلى مهامك." /><div>{checklist.map((item) => { const hasTask = data.tasks.some((task) => task.title === `متابعة: ${item.title}`); return <div className="checklist-row" key={item.id}><input type="checkbox" id={`review-${item.id}`} checked={checked.includes(item.id)} onChange={(event) => setChecked((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /><div className="min-w-0 flex-1"><label htmlFor={`review-${item.id}`}><h3>{item.title}</h3></label><p>{item.description}</p><div className="flex flex-wrap items-center justify-between gap-2"><a href={item.url} target="_blank" rel="noopener noreferrer">{item.authority}<ArrowUpLeft size={12} /></a>{canWrite && <Button variant="ghost" disabled={hasTask || !!busy} className="text-[10px]" onClick={() => { const title = `متابعة: ${item.title}`; void mutate("/api/tasks", "POST", { title }, (current) => ({ ...current, tasks: [...current.tasks, { id: demoId(), title, status: "todo", dueDate: null }] }), "أُضيف بند المتابعة إلى المهام"); }}>{hasTask ? <Check size={12} /> : <Plus size={12} />}{hasTask ? "أُضيفت للمهام" : "أضف مهمة متابعة"}</Button>}</div></div></div>; })}</div></section><div className="stack"><section className="calculator-result"><span>البنود التي راجعتها بنفسك</span><div className="result-number"><strong>{number(checked.length)}</strong><small>من {number(checklist.length)} بنود</small></div><div className="progress-track"><span style={{ width: `${checked.length / checklist.length * 100}%` }} /></div><p className="text-xs leading-loose text-muted">هذه علامات مراجعتك الشخصية. لا تُحسب منها درجة امتثال نظامية ولا تؤكد صلاحية أي سجل.</p><a className="arrow-link mt-5" href={`${base}/dashboard#tasks`}>انتقل إلى مهام المتابعة<ArrowUpLeft size={14} /></a></section><Notice>القائمة إرشادية وغير شاملة. تحقق من المتطلبات التي تنطبق على نشاطك لدى الجهة المختصة. علامات الاختيار مؤقتة في هذه الصفحة؛ مهام المتابعة تُحفظ عند إضافتها.</Notice></div></div></>;
}

export function Platforms() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const categories = [...new Set(PLATFORM_DIRECTORY.map((item) => item.category))];
  const results = PLATFORM_DIRECTORY.filter((item) => (!category || item.category === category) && `${item.name} ${item.description} ${item.category}`.includes(query));
  return <><SectionHeading title="المنصات الحكومية" description="وجهتك المختصرة للخدمات الرسمية التي تحتاجها في إدارة أعمالك." action={<Badge><Globe2 size={12} />دليل الروابط</Badge>} /><div className="filter-bar"><div className="filter-search"><Search size={16} /><input className="field" placeholder="ابحث عن منصة أو خدمة..." aria-label="البحث عن منصة" value={query} onChange={(event) => setQuery(event.target.value)} /></div><select className="field w-auto min-w-40" aria-label="تصنيف المنصات" value={category} onChange={(event) => setCategory(event.target.value)}><option value="">جميع المجالات</option>{categories.map((name) => <option value={name} key={name}>{name}</option>)}</select><span className="text-xs text-muted">{number(results.length)} منصة</span></div><div className="platform-grid">{results.map((platform) => <article className="card platform-card" key={platform.id}><span className="platform-symbol">{platform.name.slice(0, 1)}</span><div className="flex items-center justify-between gap-3"><h2>{platform.name}</h2><Badge color="gray">{platform.category}</Badge></div><p>{platform.description}</p><a href={platform.url} target="_blank" rel="noopener noreferrer" className="button button-secondary">زيارة الموقع الرسمي<ArrowUpLeft size={14} /></a></article>)}</div>{results.length === 0 && <p className="py-16 text-center text-sm text-muted">لا توجد منصات مطابقة. جرّب كلمة بحث أخرى.</p>}<p className="mt-6 text-[11px] leading-loose text-muted">الروابط تفتح مواقع الجهات في نافذة جديدة. هذا دليل وصول، ولا يعني وجود تكامل أو مشاركة بيانات بين سعود وهذه المنصات.</p></>;
}

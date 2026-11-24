"use client";

import { useState, type FormEvent } from "react";
import { Download, FilePlus2, FileText, Plus, Printer, Save, Trash2 } from "lucide-react";
import type { Letter } from "@/lib/contracts";
import { downloadText, shortDate } from "@/lib/client";
import { demoId } from "@/lib/demo";
import { Badge, Button, CardHeading, EmptyState, Notice, SectionHeading } from "../ui";
import { useWorkspace } from "../workspace-context";

type LetterDraft = Omit<Letter, "id" | "updatedAt"> & { id?: string };

export function Letters() {
  const { data, mutate, canWrite, busy } = useWorkspace();
  const [draft, setDraft] = useState<LetterDraft | null>(data.letters[0] || null);
  const [template, setTemplate] = useState("blank");
  function createDraft() {
    const definition = { title: "خطاب تعريف بالعمل", recipient: "إلى من يهمه الأمر", subject: "تعريف بالعمل", body: `السلام عليكم ورحمة الله وبركاته،\n\nتشهد ${data.profile.name || "[اسم المنشأة]"} بأن الموظف / [اسم الموظف] يعمل لديها بوظيفة / [المسمى الوظيفي]، منذ تاريخ / [تاريخ المباشرة].\n\nوقد أُعطي هذا الخطاب بناءً على طلبه لتقديمه إلى [الجهة والغرض].\n\nوتفضلوا بقبول فائق الاحترام والتقدير.\n\n[اسم المسؤول]\n[المسمى الوظيفي]\n[التاريخ]` };
    setDraft(template === "definition" ? definition : { title: "", recipient: "", subject: "", body: "" });
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const { id, title, recipient, subject, body } = draft;
    const payload = { title, recipient, subject, body };
    const saved: Letter = { ...payload, id: id || demoId(), updatedAt: new Date().toISOString() };
    if (await mutate(id ? `/api/letters/${id}` : "/api/letters", id ? "PATCH" : "POST", payload, (current) => ({ ...current, letters: id ? current.letters.map((letter) => letter.id === id ? saved : letter) : [saved, ...current.letters] }), "حُفظ الخطاب")) { if (!id) setDraft(null); }
  }
  const plain = draft ? `${draft.recipient}\n\nالموضوع: ${draft.subject}\n\n${draft.body}` : "";
  return <><SectionHeading title="الخطابات والمستندات" description="حوّل أفكارك إلى خطابات مرتبة، واحتفظ بكل مسوداتك." action={canWrite && <Button onClick={createDraft}><Plus size={16} />خطاب جديد</Button>} /><div className="split-editor"><aside className="list-items no-print"><div className="card card-pad"><CardHeading title="ابدأ من قالب" /><label className="label">نوع الخطاب<select className="field" value={template} onChange={(event) => setTemplate(event.target.value)}><option value="blank">خطاب فارغ</option><option value="definition">تعريف بالعمل</option></select></label><Button className="mt-4 w-full" variant="secondary" onClick={createDraft} disabled={!canWrite}><FilePlus2 size={15} />استخدام القالب</Button></div><div className="list-items">{data.letters.map((letter) => <button className={`list-item ${draft?.id === letter.id ? "selected" : ""}`} onClick={() => setDraft(letter)} key={letter.id}><FileText size={18} /><span><h3>{letter.title}</h3><p>آخر تعديل {shortDate(letter.updatedAt)}</p></span></button>)}</div></aside>
    {draft ? <><section className="card card-pad no-print"><CardHeading title={draft.id ? "تحرير الخطاب" : "مسودة جديدة"} action={<Badge color="gold">يحتاج مراجعتك</Badge>} /><form onSubmit={save}><div className="form-grid"><label className="label full">عنوان الحفظ<input className="field" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} required maxLength={200} placeholder="عنوان يسهل عليك الرجوع إليه" disabled={!canWrite} /></label><label className="label">الجهة المرسل إليها<input className="field" value={draft.recipient} onChange={(event) => setDraft({ ...draft, recipient: event.target.value })} maxLength={200} placeholder="اسم الجهة" disabled={!canWrite} /></label><label className="label">الموضوع<input className="field" value={draft.subject} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} maxLength={200} required placeholder="موضوع الخطاب" disabled={!canWrite} /></label><label className="label full">نص الخطاب<textarea aria-label="نص الخطاب" className="field editor-body" value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} maxLength={30000} required placeholder="اكتب نص الخطاب هنا..." disabled={!canWrite} /></label></div><div className="mt-4"><Notice>راجع الأسماء والتواريخ والمعلومات قبل اعتماد الخطاب. القوالب مسودات عامة، ولا تمثل نموذجًا معتمدًا من جهة حكومية.</Notice></div><div className="form-actions">{draft.id && canWrite && <Button type="button" variant="danger" disabled={!!busy} onClick={async () => { if (window.confirm("حذف هذا الخطاب نهائيًا من مساحة العمل؟")) { const id = draft.id!; if (await mutate(`/api/letters/${id}`, "DELETE", undefined, (current) => ({ ...current, letters: current.letters.filter((letter) => letter.id !== id) }), "حُذف الخطاب")) setDraft(null); } }}><Trash2 size={15} />حذف</Button>}<Button type="button" variant="secondary" onClick={() => downloadText(`${draft.title || "خطاب"}.txt`, plain)}><Download size={15} />تنزيل</Button><Button type="button" variant="secondary" onClick={() => window.print()}><Printer size={15} />طباعة</Button><Button busy={!!busy} disabled={!canWrite}><Save size={15} />حفظ الخطاب</Button></div></form></section><article className="print-only print-letter"><h2>{draft.recipient}</h2><h3 className="my-8">الموضوع: {draft.subject}</h3><div className="whitespace-pre-wrap leading-loose">{draft.body}</div></article></> : <section className="card"><EmptyState icon={<FileText size={26} />} title="كلماتك، بصيغة تليق بها" description="اختر خطابًا محفوظًا أو أنشئ مسودة جديدة. يمكنك تعديل النص وتنزيله أو طباعته في أي وقت.">{canWrite && <Button variant="secondary" onClick={createDraft}><Plus size={15} />إنشاء خطاب</Button>}</EmptyState></section>}
  </div></>;
}

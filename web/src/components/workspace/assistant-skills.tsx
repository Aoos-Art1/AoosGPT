"use client";

import { BookOpen, GraduationCap, Sparkles } from "lucide-react";
import { ASSISTANT_SKILLS, type AssistantMode, type AssistantSkill, type AssistantSkillSelection } from "@/lib/assistant-skills";
import { Button } from "../ui";

interface AssistantPreferencesProps {
  skill: AssistantSkillSelection;
  mode: AssistantMode;
  disabled: boolean;
  libraryOpen: boolean;
  libraryId: string;
  onSkillChange: (skill: AssistantSkillSelection) => void;
  onModeChange: (mode: AssistantMode) => void;
  onToggleLibrary: () => void;
}

export function AssistantPreferences({ skill, mode, disabled, libraryOpen, libraryId, onSkillChange, onModeChange, onToggleLibrary }: AssistantPreferencesProps) {
  return <section className="assistant-preferences" aria-label="تخصيص المساعدة">
    <div className="assistant-preference-fields">
      <label className="label">مجال المساعدة
        <select className="field" value={skill} disabled={disabled} onChange={(event) => onSkillChange(event.target.value as AssistantSkillSelection)} aria-describedby={`${libraryId}-hint`}>
          <option value="auto">تلقائي حسب سؤالي</option>
          {ASSISTANT_SKILLS.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
        </select>
      </label>
      <label className="label">أسلوب المساعدة
        <select className="field" value={mode} disabled={disabled} onChange={(event) => onModeChange(event.target.value as AssistantMode)} aria-describedby={`${libraryId}-hint`}>
          <option value="answer">إجابة مباشرة</option>
          <option value="learn">اشرح ودرّبني</option>
        </select>
      </label>
    </div>
    <div className="assistant-preference-footer">
      <p id={`${libraryId}-hint`}>
        {mode === "learn" ? <GraduationCap size={14} aria-hidden="true" /> : <Sparkles size={14} aria-hidden="true" />}
        {mode === "learn" ? "شرح متدرّج، مثال تطبيقي، ثم سؤال للتدرّب." : "إجابة مركّزة وخطوات عملية بحسب سؤالك."}
        <span>يُطبّق اختيارك على الرد التالي.</span>
      </p>
      <Button type="button" variant="ghost" aria-expanded={libraryOpen} aria-controls={libraryId} onClick={onToggleLibrary}>
        <BookOpen size={15} />{libraryOpen ? "العودة إلى المحادثة" : "استعراض المهارات"}
      </Button>
    </div>
  </section>;
}

export function AssistantSkillLibrary({ id, disabled, hidden, onExample }: { id: string; disabled: boolean; hidden: boolean; onExample: (skill: AssistantSkill) => void }) {
  return <section id={id} hidden={hidden} className="assistant-skill-library" aria-label="دليل مهارات AoosGPT">
    <div className="assistant-library-heading"><h2>كيف يمكن أن يساعدك AoosGPT؟</h2><p>مجالات لتنظيم التحليل والتعلّم؛ تنفيذ المعاملات يتم لدى الجهات المختصة. أضف مثالًا إلى مسودتك، ثم راجعه قبل الإرسال.</p></div>
    <div className="assistant-skill-grid">
      {ASSISTANT_SKILLS.map((item) => <article className="assistant-skill-card" key={item.id}>
        <h3>{item.title}</h3><p>{item.description}</p>
        <Button type="button" variant="secondary" disabled={disabled} onClick={() => onExample(item)} aria-label={`استخدم مثال ${item.title}`}>استخدم المثال</Button>
      </article>)}
    </div>
  </section>;
}

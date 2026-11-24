"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUp, ArrowUpLeft, Building2, Calculator, Copy, FileText, History, LoaderCircle, Mic, Plus, Search, ShieldCheck, Sparkles, Square, Trash2, Volume2 } from "lucide-react";
import type { Capabilities, ChatMessage } from "@/lib/contracts";
import { api, errorMessage, externalUrl, shortDate } from "@/lib/client";
import { recordingToWav } from "@/lib/audio";
import type { AssistantMode, AssistantSkill, AssistantSkillSelection } from "@/lib/assistant-skills";
import { AssistantPreferences, AssistantSkillLibrary } from "./assistant-skills";
import { AssistantMarkdown } from "./assistant-markdown";
import { Badge, Button, EmptyState, Notice, SectionHeading } from "../ui";
import { useWorkspace } from "../workspace-context";

const citationReference = (citation: ChatMessage["citations"][number]) => "reference" in citation && typeof citation.reference === "string" ? citation.reference : undefined;

const noCapabilities: Capabilities = { chat: false, transcription: false, speech: false, speechLocale: null };
const prompts = [
  { title: "أحتاج صياغة خطاب رسمي", detail: "ابدأ بمسودة قابلة للمراجعة", icon: FileText, text: "ساعدني في صياغة خطاب رسمي. اسألني عن الجهة والغرض والمعلومات التي تحتاجها أولًا." },
  { title: "رتّب خطوات إجراء حكومي", detail: "افهم المطلوب وحدد ما يلزم التحقق منه", icon: ShieldCheck, text: "أريد ترتيب خطوات إجراء حكومي لمنشأتي. اسألني عن الإجراء وحالة المنشأة قبل الإجابة، ووضح ما يحتاج التحقق من مصدر رسمي." },
  { title: "راجع خطة التوظيف", detail: "ناقش الافتراضات والتكاليف", icon: Calculator, text: "ساعدني في مراجعة ميزانية التوظيف، واسألني عن عدد الموظفين والرواتب والتكاليف التي أعرفها. لا تفترض رسومًا أو نسبًا نظامية." },
  { title: "استفد من معرفة منشأتي", detail: "اسأل عن مستندات مساحة العمل", icon: Building2, text: "ما المعلومات المتاحة في مستندات معرفة المنشأة؟ بيّن مصادر أي معلومات تستخدمها، واذكر بوضوح إن لم تتوفر مستندات مناسبة." },
];

export function Assistant({ initialConversationId }: { initialConversationId?: string }) {
  const { base } = useWorkspace();
  const router = useRouter();
  const [activeInitialId, setActiveInitialId] = useState(initialConversationId);
  const [instance, setInstance] = useState(0);
  function newConversation() {
    setActiveInitialId(undefined);
    setInstance((current) => current + 1);
    router.replace(`${base}/assistant`, { scroll: false });
  }
  return <AssistantConversation key={instance} initialConversationId={activeInitialId} onNew={newConversation} onRetry={() => setInstance((current) => current + 1)} />;
}

function AssistantConversation({ initialConversationId, onNew, onRetry }: { initialConversationId?: string; onNew: () => void; onRetry: () => void }) {
  const { demo, session, notify, refresh, canWrite } = useWorkspace();
  const [capabilities, setCapabilities] = useState<Capabilities>(noCapabilities);
  const [capabilityError, setCapabilityError] = useState("");
  const [capabilityLoaded, setCapabilityLoaded] = useState(demo);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversationId, setConversationId] = useState<string | undefined>(initialConversationId);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [skill, setSkill] = useState<AssistantSkillSelection>("auto");
  const [mode, setMode] = useState<AssistantMode>("answer");
  const [skillsOpen, setSkillsOpen] = useState(false);
  const skillLibraryId = useId();
  const [loadingHistory, setLoadingHistory] = useState(!!initialConversationId && !demo);
  const [historyReady, setHistoryReady] = useState(!initialConversationId || demo);
  const [historyError, setHistoryError] = useState("");
  const [recording, setRecording] = useState(false);
  const [requestingMicrophone, setRequestingMicrophone] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [transcribing, setTranscribing] = useState(false);
  const [speechId, setSpeechId] = useState<string | null>(null);
  const [speechBusy, setSpeechBusy] = useState<string | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const messageViewport = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const recordingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);
  const audioUrl = useRef<string | null>(null);
  const mounted = useRef(true);
  const speechRequest = useRef<AbortController | null>(null);
  const speechSequence = useRef(0);
  const chatRequest = useRef<AbortController | null>(null);
  const transcriptionRequest = useRef<AbortController | null>(null);
  const microphonePending = useRef(false);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    mounted.current = true;
    if (!demo) api<Capabilities>("/api/capabilities", { signal: controller.signal }).then((result) => { if (active) { setCapabilities(result); setCapabilityLoaded(true); } }).catch((failure) => { if (active) { setCapabilityError(errorMessage(failure)); setCapabilityLoaded(true); } });
    if (initialConversationId && !demo) api<{ messages: ChatMessage[] }>(`/api/conversations/${encodeURIComponent(initialConversationId)}`, { signal: controller.signal }).then((result) => { if (active) { setMessages(result.messages); setHistoryReady(true); } }).catch((failure) => { if (active) setHistoryError(errorMessage(failure)); }).finally(() => { if (active) setLoadingHistory(false); });
    return () => {
      active = false;
      controller.abort();
      mounted.current = false;
      chatRequest.current?.abort();
      transcriptionRequest.current?.abort();
      speechRequest.current?.abort();
      speechSequence.current += 1;
      if (recordingTimer.current) clearTimeout(recordingTimer.current);
      if (recordingInterval.current) clearInterval(recordingInterval.current);
      if (recorder.current?.state === "recording") recorder.current.stop();
      stream.current?.getTracks().forEach((track) => track.stop());
      player.current?.pause();
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    };
  }, [demo, initialConversationId, notify]);
  useEffect(() => {
    if (messages.length > 0 || sending) bottom.current?.scrollIntoView({ behavior: "auto", block: "end" });
    else messageViewport.current?.scrollTo({ top: 0, behavior: "auto" });
  }, [messages, sending]);

  const controlsDisabled = !canWrite || sending || loadingHistory || !historyReady || recording || transcribing || requestingMicrophone;

  function useSkillExample(item: AssistantSkill) {
    if (controlsDisabled) return;
    const draft = message.trim() ? `${message}\n\n${item.example}` : item.example;
    if (draft.length > 8000) { notify("المسودة طويلة لإضافة المثال. اختصرها أو انسخ ما تحتاجه قبل المحاولة.", true); return; }
    setSkill(item.id);
    setMessage(draft);
    setSkillsOpen(false);
    composer.current?.focus();
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = message.trim();
    if (!text || sending || loadingHistory || !historyReady || recording || transcribing || requestingMicrophone) return;
    if (demo) { notify("المعاينة لا تتصل بنموذج ذكاء اصطناعي. سجّل الدخول إلى مساحة عمل مهيأة لإرسال الرسائل."); return; }
    if (!capabilities.chat || !canWrite) return;
    setSkillsOpen(false);
    setSending(true);
    const controller = new AbortController();
    chatRequest.current = controller;
    try {
      const result = await api<{ conversationId: string; message: ChatMessage }>("/api/chat", { method: "POST", signal: controller.signal, body: JSON.stringify({ message: text, skill, mode, ...(conversationId ? { conversationId } : {}) }) });
      if (!mounted.current || controller.signal.aborted) return;
      setConversationId(result.conversationId);
      setMessages((current) => [...current, { id: crypto.randomUUID(), role: "user", content: text, citations: [], createdAt: new Date().toISOString() }, result.message]);
      setMessage("");
      void refresh().catch(() => undefined);
      composer.current?.focus();
    } catch (failure) { if (!controller.signal.aborted && mounted.current) notify(errorMessage(failure), true); }
    finally { if (mounted.current) setSending(false); }
  }

  async function startRecording() {
    if (loadingHistory || !historyReady || recording || transcribing || sending || microphonePending.current) return;
    if (demo) { notify("الميكروفون غير متصل في المعاينة. استخدم حسابًا مهيأً للتفريغ الصوتي."); return; }
    if (!capabilities.transcription || !canWrite) return;
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { notify("المتصفح لا يدعم التسجيل هنا. استخدم اتصال HTTPS ومتصفحًا يدعم الميكروفون.", true); return; }
    microphonePending.current = true;
    setRequestingMicrophone(true);
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) { media.getTracks().forEach((track) => track.stop()); return; }
      stream.current = media;
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find((type) => MediaRecorder.isTypeSupported(type));
      const mediaRecorder = new MediaRecorder(media, mimeType ? { mimeType } : undefined);
      recorder.current = mediaRecorder;
      const chunks: Blob[] = [];
      let bytes = 0;
      let tooLarge = false;
      mediaRecorder.ondataavailable = (event) => { if (!event.data.size) return; chunks.push(event.data); bytes += event.data.size; if (bytes > 5 * 1024 * 1024) { tooLarge = true; if (mediaRecorder.state === "recording") mediaRecorder.stop(); } };
      mediaRecorder.onerror = () => { media.getTracks().forEach((track) => track.stop()); if (mounted.current) { setRecording(false); notify("تعذّر إكمال التسجيل. حاول مرة أخرى.", true); } };
      mediaRecorder.onstop = async () => {
        media.getTracks().forEach((track) => track.stop());
        if (recordingTimer.current) clearTimeout(recordingTimer.current);
        if (recordingInterval.current) clearInterval(recordingInterval.current);
        if (!mounted.current) return;
        setRecording(false);
        if (tooLarge) { notify("التسجيل تجاوز الحجم المسموح. سجّل مقطعًا أقصر.", true); return; }
        setTranscribing(true);
        const controller = new AbortController();
        transcriptionRequest.current = controller;
        try {
          const file = await recordingToWav(new Blob(chunks, { type: mediaRecorder.mimeType }));
          if (file.size > 2 * 1024 * 1024) throw new Error("التسجيل كبير جدًا؛ الحد الأقصى ٢ ميغابايت.");
          if (!mounted.current || controller.signal.aborted) return;
          const form = new FormData(); form.append("audio", file);
          const result = await api<{ text: string }>("/api/voice/transcribe", { method: "POST", signal: controller.signal, body: form });
          if (mounted.current && !controller.signal.aborted) { setMessage((current) => `${current}${current ? "\n" : ""}${result.text}`.slice(0, 8000)); notify("أُضيف التفريغ إلى المسودة. راجعه وعدّله، ثم اضغط إرسال."); composer.current?.focus(); }
        } catch (failure) { if (mounted.current && !controller.signal.aborted) notify(errorMessage(failure), true); }
        finally { if (mounted.current) setTranscribing(false); }
      };
      setRecording(true); setRecordSeconds(0);
      mediaRecorder.start(1000);
      const started = Date.now();
      recordingInterval.current = setInterval(() => setRecordSeconds(Math.floor((Date.now() - started) / 1000)), 1000);
      recordingTimer.current = setTimeout(() => { if (mediaRecorder.state === "recording") mediaRecorder.stop(); }, 59000);
    } catch (failure) { stream.current?.getTracks().forEach((track) => track.stop()); if (mounted.current) notify(failure instanceof DOMException && failure.name === "NotAllowedError" ? "لم يتم السماح باستخدام الميكروفون. يمكنك كتابة رسالتك أو تعديل إذن المتصفح." : errorMessage(failure), true); }
    finally { microphonePending.current = false; if (mounted.current) setRequestingMicrophone(false); }
  }

  async function speak(item: ChatMessage) {
    if (speechId === item.id) { player.current?.pause(); setSpeechId(null); return; }
    speechRequest.current?.abort();
    const controller = new AbortController();
    speechRequest.current = controller;
    const sequence = ++speechSequence.current;
    setSpeechBusy(item.id); player.current?.pause();
    try {
      const response = await fetch("/api/voice/speak", { method: "POST", signal: controller.signal, credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: item.content.slice(0, 2000) }) });
      if (!response.ok) { const result = await response.json().catch(() => null); throw new Error(result?.error?.message || "تعذّر إنشاء الصوت."); }
      const blob = await response.blob();
      if (!mounted.current || controller.signal.aborted || sequence !== speechSequence.current) return;
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
      audioUrl.current = URL.createObjectURL(blob);
      const audio = new Audio(audioUrl.current); player.current = audio;
      audio.onended = () => { if (mounted.current && sequence === speechSequence.current) setSpeechId(null); };
      audio.onerror = () => { if (mounted.current && sequence === speechSequence.current) { setSpeechId(null); notify("تعذّر تشغيل الصوت في هذا المتصفح.", true); } };
      await audio.play();
      if (!mounted.current || controller.signal.aborted || sequence !== speechSequence.current) { audio.pause(); return; }
      setSpeechId(item.id);
    } catch (failure) { if (!controller.signal.aborted && mounted.current) notify(errorMessage(failure), true); }
    finally { if (mounted.current && sequence === speechSequence.current) setSpeechBusy(null); }
  }

  return <div className="chat-layout"><div className="chat-top"><div><span className="brand-mark"><Sparkles size={22} /></span><span><h1>AoosGPT، مساعدك الذكي</h1><p>{demo ? "معاينة الواجهة — دون اتصال بالنموذج" : "محادثاتك ومعرفة منشأتك في مكان واحد"}</p></span><Badge color={capabilities.chat ? "green" : "gray"}>{demo ? "معاينة" : !capabilityLoaded ? "جارٍ التحقق" : capabilities.chat ? "الخدمة مهيأة" : "غير مهيأ"}</Badge></div><Button variant="ghost" onClick={onNew}><Plus size={15} />محادثة جديدة</Button></div>
    <AssistantPreferences skill={skill} mode={mode} disabled={controlsDisabled} libraryOpen={skillsOpen} libraryId={skillLibraryId} onSkillChange={setSkill} onModeChange={setMode} onToggleLibrary={() => setSkillsOpen((open) => !open)} />
    <div ref={messageViewport} className="chat-messages"><AssistantSkillLibrary id={skillLibraryId} disabled={controlsDisabled} hidden={!skillsOpen} onExample={useSkillExample} />{!skillsOpen && <>{historyError && <div className="mb-4 stack"><Notice kind="error">تعذّر تحميل سجل المحادثة: {historyError}</Notice><Button variant="secondary" onClick={onRetry}>إعادة تحميل المحادثة</Button></div>}{capabilityError && <Notice kind="error">{capabilityError}</Notice>}{!demo && capabilityLoaded && !capabilities.chat && !capabilityError && <Notice>المحادثة غير مهيأة لهذه البيئة حاليًا. يستطيع مشغّل المنصة تفعيل مزود الخدمة من إعدادات الخادم.</Notice>}{!canWrite && <Notice>صلاحيتك الحالية تتيح قراءة المحادثات. إرسال الرسائل يحتاج إلى صلاحية كتابة.</Notice>}{loadingHistory ? <div className="empty-state"><LoaderCircle className="animate-spin text-emerald" size={25} /><p>جارٍ تحميل المحادثة...</p></div> : messages.length === 0 ? <div className="chat-welcome"><div className="assistant-emblem"><Sparkles size={37} strokeWidth={1.5} /></div><h2>حيّاك، وش ننجز اليوم؟</h2><p>أنا AoosGPT. أساعدك في ترتيب أفكارك وصياغة مستنداتك وفهم ما يحتاج إلى متابعة في أعمالك.</p><div className="prompt-grid">{prompts.map((prompt) => <button className="prompt-card" key={prompt.title} disabled={controlsDisabled} onClick={() => { setMessage(prompt.text); composer.current?.focus(); }}><prompt.icon size={20} strokeWidth={1.5} /><div>{prompt.title}<span>{prompt.detail}</span></div></button>)}</div>{demo && <p className="mt-5 text-[10px]">هذه معاينة تفاعلية للواجهة. لن تُنشأ ردود آلية أو محادثات محفوظة.</p>}</div> : messages.map((item) => <article key={item.id} className={`chat-message message-${item.role}`}><span className="avatar">{item.role === "assistant" ? <Sparkles size={16} /> : session?.displayName.slice(0, 1) || "أ"}</span><div className="message-content"><small>{item.role === "assistant" ? "AoosGPT" : "أنت"}</small>{item.role === "assistant" ? <AssistantMarkdown content={item.content} /> : <p>{item.content}</p>}{item.citations.length > 0 && <div className="citations" aria-label="المصادر المرجعية">{item.citations.map((citation) => externalUrl(citation.url) ? <a href={externalUrl(citation.url)} key={citation.id} title={citation.excerpt} target="_blank" rel="noopener noreferrer"><FileText size={11} />{citationReference(citation) && <b dir="ltr">[{citationReference(citation)}]</b>}{citation.title}<ArrowUpLeft size={10} /></a> : <span key={citation.id} title={citation.excerpt}><FileText size={11} />{citationReference(citation) && <b dir="ltr">[{citationReference(citation)}]</b>}{citation.title}</span>)}</div>}<div className="mt-3 flex flex-wrap items-center gap-2"><button className="button button-ghost min-h-7 px-1 py-0 text-[10px]" onClick={async () => { try { await navigator.clipboard.writeText(item.content); notify("نُسخ النص"); } catch { notify("تعذّر النسخ. يمكنك تحديد النص ونسخه يدويًا.", true); } }}><Copy size={12} />نسخ</button>{item.role === "assistant" && capabilities.speech && canWrite && <button className="button button-ghost min-h-7 px-1 py-0 text-[10px]" disabled={!!speechBusy} onClick={() => void speak(item)}>{speechBusy === item.id ? <LoaderCircle size={12} className="animate-spin" /> : speechId === item.id ? <Square size={11} /> : <Volume2 size={12} />}{speechId === item.id ? "إيقاف الصوت" : item.content.length > 2000 ? "قراءة أول ٢٠٠٠ حرف — صوت اصطناعي" : "استماع — صوت اصطناعي"}</button>}</div></div></article>)}{sending && <div role="status" className="chat-message"><span className="avatar"><Sparkles size={15} /></span><div className="message-content flex items-center gap-3 text-xs text-muted"><LoaderCircle className="animate-spin" size={15} />AoosGPT يراجع طلبك...</div></div>}<div ref={bottom} /></>}</div>
    <form className="composer" onSubmit={send}><textarea ref={composer} value={message} onChange={(event) => setMessage(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="اسأل AoosGPT... أو ابدأ بوصف ما تحتاجه" maxLength={8000} rows={2} aria-label="رسالتك إلى AoosGPT" disabled={sending || loadingHistory || !historyReady || !canWrite} /><div className="composer-bottom"><div className="composer-tools"><button type="button" className={`icon-button ${recording ? "recording" : ""}`} aria-label={recording ? "إيقاف التسجيل وإعداد التفريغ" : "تسجيل رسالة صوتية"} title={!demo && !capabilities.transcription ? "التفريغ الصوتي غير مهيأ" : "التسجيل لمدة أقصاها ٦٠ ثانية"} disabled={transcribing || requestingMicrophone || loadingHistory || !historyReady || sending || (!demo && (!capabilities.transcription || !canWrite))} onClick={() => { if (recording) recorder.current?.stop(); else void startRecording(); }}>{transcribing || requestingMicrophone ? <LoaderCircle className="animate-spin" size={16} /> : recording ? <Square size={14} /> : <Mic size={16} />}</button><span className="composer-hint">{recording ? `جارٍ التسجيل... ${recordSeconds} ثانية · اضغط للإيقاف` : transcribing ? "جارٍ تفريغ الصوت للمراجعة..." : "Enter للإرسال · Shift + Enter لسطر جديد"}</span></div><Button aria-label="إرسال الرسالة" disabled={!message.trim() || sending || loadingHistory || !historyReady || recording || requestingMicrophone || transcribing || (!demo && (!capabilities.chat || !canWrite))}>{sending ? <LoaderCircle size={17} className="animate-spin" /> : <ArrowUp size={19} />}</Button></div></form><p className="chat-disclosure">قد يخطئ AoosGPT. راجع المعلومات والأنظمة لدى مصادرها الرسمية. {capabilities.speech && "الصوت مولّد بالذكاء الاصطناعي."}</p>
  </div>;
}

export function ConversationHistory() {
  const { data, base, mutate, busy, canWrite } = useWorkspace();
  const [query, setQuery] = useState("");
  const results = data.conversations.filter((item) => item.title.includes(query));
  return <><SectionHeading title="سجل المحادثات" description="أفكارك وخطوات عملك، محفوظة للرجوع إليها." action={<Link href={`${base}/assistant`} className="button button-primary"><Plus size={15} />محادثة جديدة</Link>} />{data.conversations.length ? <><div className="filter-bar"><div className="filter-search"><Search size={16} /><input className="field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ابحث عن محادثة..." aria-label="البحث في سجل المحادثات" /></div></div><div className="list-items">{results.map((item) => <div key={item.id} className="list-item"><History size={18} /><Link className="min-w-0 flex-1" href={`${base}/assistant?conversation=${encodeURIComponent(item.id)}`}><h3>{item.title}</h3><p>آخر تحديث {shortDate(item.updatedAt)}</p></Link>{canWrite && <button className="icon-button" disabled={!!busy} aria-label={`حذف محادثة ${item.title}`} onClick={() => { if (window.confirm("حذف المحادثة ورسائلها نهائيًا؟")) void mutate(`/api/conversations/${item.id}`, "DELETE", undefined, (current) => ({ ...current, conversations: current.conversations.filter((conversation) => conversation.id !== item.id) }), "حُذفت المحادثة"); }}><Trash2 size={14} /></button>}</div>)}</div>{results.length === 0 && <p className="py-10 text-center text-sm text-muted">لا توجد محادثات مطابقة للبحث.</p>}</> : <section className="card"><EmptyState icon={<History size={26} />} title="كل فكرة لها بداية" description="عندما تبدأ محادثة في مساحة عمل متصلة، ستجدها هنا لتكمل من حيث توقفت."><Link href={`${base}/assistant`} className="button button-secondary"><Sparkles size={15} />انتقل إلى AoosGPT</Link></EmptyState></section>}</>;
}

/** Public descriptions only. Trusted execution instructions remain on the server. */
export const ASSISTANT_SKILL_IDS = [
  "aoos-gr-orchestrator",
  "aoos-client-advisor",
  "aoos-labor-compliance",
  "aoos-immigration-visas",
  "aoos-business-licensing",
  "aoos-government-updates",
  "aoos-municipal-safety-health",
  "aoos-case-resolution",
  "aoos-official-source-research",
] as const;

export type AssistantSkillId = (typeof ASSISTANT_SKILL_IDS)[number];
export type AssistantSkillSelection = "auto" | AssistantSkillId;

export const ASSISTANT_MODES = ["answer", "learn"] as const;
export type AssistantMode = (typeof ASSISTANT_MODES)[number];

export interface AssistantSkill {
  id: AssistantSkillId;
  title: string;
  description: string;
  example: string;
  origin: "attached" | "added";
}

export const ASSISTANT_SKILLS = [
  {
    id: "aoos-gr-orchestrator",
    title: "تنسيق العلاقات الحكومية",
    description: "تحديد الإجراء والجهات المرتبطة به، وترتيب المتطلبات والمسؤوليات وخطوات المتابعة.",
    example: "أحتاج خطة عمل لإجراء حكومي لمنشأتي. اسألني عن نوع الإجراء وحالة المنشأة، ثم رتّب المتطلبات والجهات والمسؤوليات وما يحتاج إلى تحقق.",
    origin: "attached",
  },
  {
    id: "aoos-client-advisor",
    title: "خدمة المستفيدين وصياغة الردود",
    description: "فهم طلب المستفيد، واستكمال المعلومات الناقصة، وصياغة رد واضح وخطوة تالية قابلة للتنفيذ.",
    example: "ساعدني في الرد على مستفيد يسأل عن تأخر معاملته. اسألني عن وضع الطلب والمعلومات المتاحة، وصغ ردًا مهنيًا دون وعد بموعد غير مؤكد.",
    origin: "attached",
  },
  {
    id: "aoos-labor-compliance",
    title: "العمل والالتزام",
    description: "تنظيم مسائل العمل والتوطين والعقود وحماية الأجور، مع فصل الوقائع عن البنود التي تتطلب مرجعًا حديثًا.",
    example: "أريد مراجعة أولويات الالتزام العمالي لمنشأة. اسألني عن النشاط والموظفين والعقود وحماية الأجور، ولا تفترض نسبًا أو مهلًا نظامية غير موثقة.",
    origin: "attached",
  },
  {
    id: "aoos-immigration-visas",
    title: "الإقامات والتأشيرات",
    description: "تحليل متطلبات الإقامة والتأشيرة بحسب الحالة، وترتيب المستندات والجهة المختصة ومواطن التحقق.",
    example: "أحتاج فهم خطوات إجراء مرتبط بإقامة أو تأشيرة. اسألني أولًا عن نوع الإجراء وحالة المستفيد، وبيّن المستندات والمعلومات التي يجب التحقق منها رسميًا.",
    origin: "attached",
  },
  {
    id: "aoos-business-licensing",
    title: "التراخيص التجارية والاستثمار",
    description: "ربط النشاط والشكل القانوني بالتراخيص المطلوبة، وبناء قائمة تحقق من المصادر والوثائق.",
    example: "أخطط لفتح فرع لمنشأة. اسألني عن النشاط والمدينة والشكل القانوني ونوع الملكية، ثم ضع قائمة تحقق للتراخيص دون افتراض رسوم أو مدد.",
    origin: "attached",
  },
  {
    id: "aoos-government-updates",
    title: "تحليل المستجدات الحكومية",
    description: "تحليل التحديثات والنصوص المقدمة، وتحديد أثرها وتاريخ نفاذها وما يستحق المتابعة.",
    example: "أريد تحليل تحديث حكومي. اطلب مني النص أو المصدر وتاريخه، ثم وضّح ما تغيّر ومن يتأثر وما الإجراء المقترح، دون ادعاء متابعة تلقائية للمستجدات.",
    origin: "attached",
  },
  {
    id: "aoos-municipal-safety-health",
    title: "البلدية والسلامة والصحة",
    description: "تنظيم متطلبات الموقع والنشاط والسلامة والصحة، مع تمييز اختصاص كل جهة والأدلة المطلوبة.",
    example: "ساعدني في ترتيب مراجعة التراخيص البلدية والسلامة والصحة لموقع منشأة. اسألني عن النشاط والموقع والتراخيص الحالية قبل إعداد قائمة المتابعة.",
    origin: "added",
  },
  {
    id: "aoos-case-resolution",
    title: "حل الحالات والتصعيد",
    description: "بناء تسلسل زمني للحالة، وفحص الأدلة والبدائل، وتحديد خطوة المتابعة أو التصعيد المناسبة.",
    example: "لدي معاملة متعثرة وأريد تشخيص سبب التعثر. اسألني عن تسلسل الأحداث والردود والمستندات، ثم قارن خيارات المعالجة والتصعيد مع توضيح النواقص.",
    origin: "added",
  },
  {
    id: "aoos-official-source-research",
    title: "مراجعة المصادر والأدلة",
    description: "تقييم النصوص المتاحة وفصل الادعاءات عن الأدلة، ثم إعداد خطة لاستكمال التحقق من المعلومات الناقصة.",
    example: "ساعدني في مراجعة دليل لإجراء حكومي. اطلب مني نص المصدر أو مستنده وموضوع الإجراء، وميّز ما تؤيده الأدلة المتاحة مما يحتاج تحققًا إضافيًا؛ الرابط وحده لا يُفتح تلقائيًا.",
    origin: "added",
  },
] as const satisfies readonly AssistantSkill[];

import type { Section } from "@/lib/contracts";

export const NAVIGATION: { id: Section; label: string; description: string; group: "workspace" | "organization" }[] = [
  { id: "dashboard", label: "لوحة التحكم", description: "نظرة شاملة على أعمالك", group: "workspace" },
  { id: "assistant", label: "المساعد الذكي", description: "مساحة محادثة سعود", group: "workspace" },
  { id: "history", label: "سجل المحادثات", description: "ارجع إلى محادثاتك السابقة", group: "workspace" },
  { id: "letters", label: "الخطابات والمستندات", description: "صياغة خطاباتك وحفظها", group: "workspace" },
  { id: "calculators", label: "الحاسبات", description: "حسابات واضحة بمدخلاتك", group: "workspace" },
  { id: "compliance", label: "متابعة الامتثال", description: "قائمة مراجعة داخلية لمنشأتك", group: "organization" },
  { id: "hiring", label: "التوظيف والتكاليف", description: "خطط ميزانية فريقك", group: "organization" },
  { id: "platforms", label: "المنصات الحكومية", description: "روابط الخدمات الرسمية", group: "organization" },
  { id: "company", label: "بيانات المنشأة", description: "ملف منشأتك وفريق العمل", group: "organization" },
  { id: "settings", label: "الإعدادات", description: "المعرفة والذاكرة والتفضيلات", group: "organization" },
];

export function isSection(value: string): value is Section {
  return NAVIGATION.some((item) => item.id === value);
}

export const sectionInfo = (section: Section) => NAVIGATION.find((item) => item.id === section)!;

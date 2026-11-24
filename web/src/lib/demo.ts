import type { ChatMessage, WorkspaceData } from "@/lib/contracts";

const initialDemo: WorkspaceData = {
  profile: { name: "شركة أفق الأعمال", registration: "— بيانات توضيحية —", activity: "خدمات الأعمال", city: "الرياض", email: "hello@example.com", phone: "" },
  employees: [
    { id: "demo-e1", name: "عبدالله القحطاني", job: "مدير العمليات", nationality: "saudi", monthlySalary: 14000, documentExpiry: null },
    { id: "demo-e2", name: "نورة السبيعي", job: "أخصائية موارد بشرية", nationality: "saudi", monthlySalary: 9500, documentExpiry: null },
    { id: "demo-e3", name: "خالد العتيبي", job: "أخصائي علاقات حكومية", nationality: "saudi", monthlySalary: 10000, documentExpiry: null },
    { id: "demo-e4", name: "سارة الدوسري", job: "مديرة حسابات", nationality: "saudi", monthlySalary: 12000, documentExpiry: null },
    { id: "demo-e5", name: "أحمد حسن", job: "محاسب", nationality: "other", monthlySalary: 8000, documentExpiry: null },
    { id: "demo-e6", name: "يوسف علي", job: "مطور برمجيات", nationality: "other", monthlySalary: 13000, documentExpiry: null },
    { id: "demo-e7", name: "ريم الحربي", job: "أخصائية تسويق", nationality: "saudi", monthlySalary: 9000, documentExpiry: null },
    { id: "demo-e8", name: "عمر سعيد", job: "منسق خدمات", nationality: "other", monthlySalary: 7000, documentExpiry: null },
  ],
  tasks: [
    { id: "demo-t1", title: "مراجعة ملف الموظفين وتحديث المستندات", dueDate: null, status: "todo" },
    { id: "demo-t2", title: "إعداد خطاب التعريف للموظفين الجدد", dueDate: null, status: "todo" },
    { id: "demo-t3", title: "تجهيز ميزانية التوظيف للربع القادم", dueDate: null, status: "todo" },
    { id: "demo-t4", title: "تحديث بيانات المنشأة الأساسية", dueDate: null, status: "done" },
  ],
  letters: [
    { id: "demo-l1", title: "خطاب تعريف بالعمل", recipient: "إلى من يهمه الأمر", subject: "تعريف بالعمل", body: "السلام عليكم ورحمة الله وبركاته،\n\nتشهد شركة أفق الأعمال بأن الموظف / [اسم الموظف] يعمل لديها بوظيفة / [المسمى الوظيفي]، وذلك منذ تاريخ / [تاريخ المباشرة].\n\nوقد أُعطي هذا الخطاب بناءً على طلبه، دون أدنى مسؤولية على المنشأة.\n\nوتفضلوا بقبول فائق الاحترام والتقدير.\n\n[اسم المسؤول]\n[المسمى الوظيفي]\n[التاريخ]", updatedAt: "2026-11-23T08:00:00Z" },
  ],
  conversations: [],
  documents: [],
  memories: [],
  memoryEnabled: false,
};

let current: WorkspaceData = structuredClone(initialDemo);
export const demoMessages = new Map<string, ChatMessage[]>();
export function readDemo(): WorkspaceData { return structuredClone(current); }
export function updateDemo(next: WorkspaceData): WorkspaceData { current = structuredClone(next); return structuredClone(current); }
export function resetDemo(): WorkspaceData { current = structuredClone(initialDemo); demoMessages.clear(); return readDemo(); }
export const demoId = () => `demo-${crypto.randomUUID()}`;

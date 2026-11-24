export type Portal = "individual" | "company" | "admin";
export type TenantKind = "individual" | "company";
export type TenantRole = "owner" | "admin" | "member" | "viewer";
export type PlatformRole = "user" | "super_admin";

export interface SessionContext {
  sessionId: string;
  userId: string;
  email: string;
  displayName: string;
  platformRole: PlatformRole;
  portal: Portal;
  tenantId: string | null;
  tenantName: string | null;
  tenantKind: TenantKind | null;
  tenantRole: TenantRole | null;
}

export type TenantSession = SessionContext & {
  tenantId: string;
  tenantName: string;
  tenantKind: TenantKind;
  tenantRole: TenantRole;
};

export type Section = "dashboard" | "assistant" | "history" | "letters" | "calculators" | "compliance" | "hiring" | "platforms" | "company" | "settings";

export interface CompanyProfile {
  name: string;
  registration: string;
  activity: string;
  city: string;
  email: string;
  phone: string;
}

export interface Employee {
  id: string;
  name: string;
  job: string;
  nationality: "saudi" | "other";
  monthlySalary: number;
  documentExpiry: string | null;
}

export interface WorkspaceTask {
  id: string;
  title: string;
  dueDate: string | null;
  status: "todo" | "done";
}

export interface Letter {
  id: string;
  title: string;
  recipient: string;
  subject: string;
  body: string;
  updatedAt: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export interface KnowledgeDocument {
  id: string;
  title: string;
  sourceUrl: string | null;
  createdAt: string;
  chunkCount: number;
}

export interface SourceCitation {
  id: string;
  /** Exact inline marker for new citations; absent only on legacy stored messages. */
  reference?: string;
  title: string;
  excerpt: string;
  url?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: SourceCitation[];
  createdAt: string;
}

export interface SavedMemory {
  id: string;
  content: string;
  createdAt: string;
}

export interface WorkspaceData {
  profile: CompanyProfile;
  employees: Employee[];
  tasks: WorkspaceTask[];
  letters: Letter[];
  conversations: ConversationSummary[];
  documents: KnowledgeDocument[];
  memories: SavedMemory[];
  memoryEnabled: boolean;
}

export interface Capabilities {
  chat: boolean;
  transcription: boolean;
  speech: boolean;
  speechLocale: string | null;
}

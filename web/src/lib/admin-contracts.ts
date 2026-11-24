import type { TenantKind, TenantRole } from "./contracts";

export interface PageMeta { page: number; limit: number; total: number; totalPages: number }
export interface AdminTenant { id: string; name: string; kind: TenantKind; status: "active" | "suspended"; plan: "free" | "starter" | "professional" | "enterprise"; memberCount: number; createdAt: string }
export interface AdminUser { id: string; email: string; displayName: string; platformRole: string; disabled: boolean; createdAt: string; memberships: { tenantId: string; tenantName: string; role: TenantRole }[] }

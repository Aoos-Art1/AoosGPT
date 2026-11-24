import "server-only";
import type {PoolClient} from "pg";
import type {TenantSession} from "@/lib/contracts";
import {WORKSPACE_LIMITS} from "@/lib/limits";
import {AppError} from "./http";

const scopes={employees:false,tasks:false,letters:true,conversations:true} as const;
export async function assertRecordCapacity(db:PoolClient,ctx:TenantSession,resource:keyof typeof scopes) {
  const personal=scopes[resource];
  const key=`capacity:${resource}:${ctx.tenantId}:${personal?ctx.userId:"shared"}`;
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[key]);
  // resource comes exclusively from the static server allowlist above.
  const result=await db.query<{count:string}>(`SELECT count(*)::text AS count FROM ${resource} WHERE tenant_id=$1${personal?" AND user_id=$2":""}`,personal?[ctx.tenantId,ctx.userId]:[ctx.tenantId]);
  if(Number(result.rows[0].count)>=WORKSPACE_LIMITS[resource]) {
    throw new AppError(409,"WORKSPACE_CAPACITY","بلغت الحد الحالي لهذا النوع من السجلات. راجع حدود مساحة العمل في الإعدادات.");
  }
}

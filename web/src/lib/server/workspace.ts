import "server-only";
import type { CompanyProfile, TenantSession, WorkspaceData } from "@/lib/contracts";
import { withTenant } from "@/lib/server/db";

export async function loadWorkspace(ctx: TenantSession): Promise<WorkspaceData> {
  return withTenant(ctx, async (db) => {
    const profile = await db.query<CompanyProfile>("SELECT name,registration,activity,city,email,phone FROM profiles WHERE tenant_id=$1", [ctx.tenantId]);
    const employees = await db.query('SELECT id,name,job,nationality,monthly_salary AS "monthlySalary",document_expiry::text AS "documentExpiry" FROM employees WHERE tenant_id=$1 ORDER BY name LIMIT 1000', [ctx.tenantId]);
    const tasks = await db.query('SELECT id,title,due_date::text AS "dueDate",status FROM tasks WHERE tenant_id=$1 ORDER BY due_date NULLS LAST,created_at DESC LIMIT 300', [ctx.tenantId]);
    const letters = await db.query('SELECT id,title,recipient,subject,body,updated_at AS "updatedAt" FROM letters WHERE tenant_id=$1 AND user_id=$2 ORDER BY updated_at DESC LIMIT 100', [ctx.tenantId,ctx.userId]);
    const conversations = await db.query('SELECT id,title,updated_at AS "updatedAt" FROM conversations WHERE tenant_id=$1 AND user_id=$2 ORDER BY updated_at DESC LIMIT 100', [ctx.tenantId,ctx.userId]);
    const documents = await db.query('SELECT d.id,d.title,d.source_url AS "sourceUrl",d.created_at AS "createdAt",count(c.id)::int AS "chunkCount" FROM documents d LEFT JOIN document_chunks c ON c.tenant_id=d.tenant_id AND c.document_id=d.id WHERE d.tenant_id=$1 GROUP BY d.id ORDER BY d.created_at DESC LIMIT 100', [ctx.tenantId]);
    const memories = await db.query('SELECT id,content,created_at AS "createdAt" FROM memories WHERE tenant_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 100', [ctx.tenantId,ctx.userId]);
    const preferences = await db.query('SELECT memory_enabled FROM preferences WHERE tenant_id=$1 AND user_id=$2', [ctx.tenantId,ctx.userId]);
    return {
      profile: profile.rows[0] ?? {name:ctx.tenantName,registration:"",activity:"",city:"",email:"",phone:""},
      employees: employees.rows.map(row => ({...row, monthlySalary:Number(row.monthlySalary)})),
      tasks: tasks.rows,
      letters: letters.rows.map(row => ({...row,updatedAt:new Date(row.updatedAt).toISOString()})),
      conversations: conversations.rows.map(row => ({...row,updatedAt:new Date(row.updatedAt).toISOString()})),
      documents: documents.rows.map(row => ({...row,createdAt:new Date(row.createdAt).toISOString()})),
      memories: memories.rows.map(row => ({...row,createdAt:new Date(row.createdAt).toISOString()})),
      memoryEnabled: preferences.rows[0]?.memory_enabled === true
    } as WorkspaceData;
  });
}

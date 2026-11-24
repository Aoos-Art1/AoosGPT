import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/server/auth";
import { withTenant } from "@/lib/server/db";
import { assertSameOrigin, jsonError, readJson } from "@/lib/server/http";
import { letterSchema } from "@/lib/server/business-schemas";
import { assertRecordCapacity } from "@/lib/server/capacity";
export const dynamic="force-dynamic";
export async function GET() {
  try {
    const ctx=await requireTenant();
    const letters=await withTenant(ctx,async db=>(await db.query('SELECT id,title,recipient,subject,body,updated_at AS "updatedAt" FROM letters WHERE tenant_id=$1 AND user_id=$2 ORDER BY updated_at DESC LIMIT 100',[ctx.tenantId,ctx.userId])).rows);
    return NextResponse.json({letters},{headers:{"Cache-Control":"private, no-store"}});
  } catch(error) { return jsonError(error); }
}
export async function POST(request:Request) {
  try {
    assertSameOrigin(request);
    const ctx=await requireTenant("write");
    const data=await readJson(request,letterSchema,180_000);
    const letter=await withTenant(ctx,async db=> {
      await assertRecordCapacity(db,ctx,"letters");
      const result=await db.query(`INSERT INTO letters(tenant_id,user_id,title,recipient,subject,body) VALUES($1,$2,$3,$4,$5,$6) RETURNING id,updated_at AS "updatedAt"`,[ctx.tenantId,ctx.userId,data.title,data.recipient,data.subject,data.body]);
      return {...result.rows[0],...data};
    });
    return NextResponse.json({letter},{status:201});
  } catch(error) { return jsonError(error); }
}

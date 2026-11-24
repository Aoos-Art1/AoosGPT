import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/server/auth";
import { withTenant } from "@/lib/server/db";
import { AppError, assertSameOrigin, jsonError, readJson } from "@/lib/server/http";
import { idSchema,letterSchema } from "@/lib/server/business-schemas";
type Context={params:Promise<{id:string}>};
export async function PATCH(request:Request,context:Context) {
  try {
    assertSameOrigin(request);
    const ctx=await requireTenant("write");
    const id=idSchema.parse((await context.params).id);
    const data=await readJson(request,letterSchema,180_000);
    await withTenant(ctx,async db=> {
      const result=await db.query("UPDATE letters SET title=$1,recipient=$2,subject=$3,body=$4,updated_at=now() WHERE id=$5 AND tenant_id=$6 AND user_id=$7 RETURNING id",[data.title,data.recipient,data.subject,data.body,id,ctx.tenantId,ctx.userId]);
      if (!result.rowCount) throw new AppError(404,"NOT_FOUND","لم يُعثر على الخطاب.");
    });
    return NextResponse.json({updated:true});
  } catch(error) { return jsonError(error); }
}
export async function DELETE(request:Request,context:Context) {
  try {
    assertSameOrigin(request);
    const ctx=await requireTenant("write");
    const id=idSchema.parse((await context.params).id);
    await withTenant(ctx,async db=> {
      const result=await db.query("DELETE FROM letters WHERE id=$1 AND tenant_id=$2 AND user_id=$3 RETURNING id",[id,ctx.tenantId,ctx.userId]);
      if (!result.rowCount) throw new AppError(404,"NOT_FOUND","لم يُعثر على الخطاب.");
    });
    return NextResponse.json({deleted:true});
  } catch(error) { return jsonError(error); }
}

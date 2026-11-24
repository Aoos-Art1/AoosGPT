import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/server/auth";
import { withTenant } from "@/lib/server/db";
import { AppError, assertSameOrigin, jsonError } from "@/lib/server/http";
import { idSchema } from "@/lib/server/business-schemas";
export async function DELETE(request:Request,context:{params:Promise<{id:string}>}) {
  try {
    assertSameOrigin(request);
    const ctx=await requireTenant("manage");
    const id=idSchema.parse((await context.params).id);
    await withTenant(ctx,async db => {
      const result=await db.query("DELETE FROM employees WHERE id=$1 AND tenant_id=$2 RETURNING id",[id,ctx.tenantId]);
      if (!result.rowCount) throw new AppError(404,"NOT_FOUND","لم يُعثر على السجل.");
    });
    return NextResponse.json({deleted:true});
  } catch(error) { return jsonError(error); }
}

import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/server/auth";
import { withTenant } from "@/lib/server/db";
import { AppError, assertSameOrigin, jsonError, readJson } from "@/lib/server/http";
import { idSchema,taskUpdateSchema } from "@/lib/server/business-schemas";
type Context={params:Promise<{id:string}>};
export async function PATCH(request:Request,context:Context) {
  try {
    assertSameOrigin(request);
    const ctx=await requireTenant("write");
    const id=idSchema.parse((await context.params).id);
    const data=await readJson(request,taskUpdateSchema);
    await withTenant(ctx,async db=> {
      const result=await db.query("UPDATE tasks SET status=$1 WHERE id=$2 AND tenant_id=$3 RETURNING id",[data.status,id,ctx.tenantId]);
      if (!result.rowCount) throw new AppError(404,"NOT_FOUND","لم يُعثر على المهمة.");
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
      const result=await db.query("DELETE FROM tasks WHERE id=$1 AND tenant_id=$2 RETURNING id",[id,ctx.tenantId]);
      if (!result.rowCount) throw new AppError(404,"NOT_FOUND","لم يُعثر على المهمة.");
    });
    return NextResponse.json({deleted:true});
  } catch(error) { return jsonError(error); }
}

import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/server/auth";
import { withTenant } from "@/lib/server/db";
import { assertSameOrigin, jsonError, readJson } from "@/lib/server/http";
import { taskSchema } from "@/lib/server/business-schemas";
import { assertRecordCapacity } from "@/lib/server/capacity";
export async function POST(request:Request) {
  try {
    assertSameOrigin(request);
    const ctx=await requireTenant("write");
    const data=await readJson(request,taskSchema);
    const task=await withTenant(ctx,async db => {
      await assertRecordCapacity(db,ctx,"tasks");
      const result=await db.query("INSERT INTO tasks(tenant_id,title,due_date,status) VALUES($1,$2,$3,'todo') RETURNING id",[ctx.tenantId,data.title,data.dueDate]);
      return {id:result.rows[0].id,...data,status:"todo"};
    });
    return NextResponse.json({task},{status:201});
  } catch(error) { return jsonError(error); }
}

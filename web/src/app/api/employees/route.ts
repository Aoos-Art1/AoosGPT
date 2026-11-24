import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/server/auth";
import { withTenant } from "@/lib/server/db";
import { assertSameOrigin, jsonError, readJson } from "@/lib/server/http";
import { employeeSchema } from "@/lib/server/business-schemas";
import { assertRecordCapacity } from "@/lib/server/capacity";
export async function POST(request:Request) {
  try {
    assertSameOrigin(request);
    const ctx=await requireTenant("manage");
    const data=await readJson(request,employeeSchema);
    const employee=await withTenant(ctx, async db => {
      await assertRecordCapacity(db,ctx,"employees");
      const result=await db.query(`INSERT INTO employees(tenant_id,name,job,nationality,monthly_salary,document_expiry)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,[ctx.tenantId,data.name,data.job,data.nationality,data.monthlySalary,data.documentExpiry]);
      return {id:result.rows[0].id,...data};
    });
    return NextResponse.json({employee},{status:201});
  } catch(error) { return jsonError(error); }
}

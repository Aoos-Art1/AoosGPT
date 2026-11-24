import { NextResponse } from "next/server";
import { requireTenant } from "@/lib/server/auth";
import { withTenant } from "@/lib/server/db";
import { assertSameOrigin, jsonError, readJson } from "@/lib/server/http";
import { profileSchema } from "@/lib/server/business-schemas";
export async function PATCH(request:Request) {
  try {
    assertSameOrigin(request);
    const ctx = await requireTenant("manage");
    const data = await readJson(request, profileSchema);
    await withTenant(ctx, async db => {
      await db.query(`INSERT INTO profiles (tenant_id,name,registration,activity,city,email,phone)
        VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (tenant_id) DO UPDATE SET name=EXCLUDED.name,
        registration=EXCLUDED.registration,activity=EXCLUDED.activity,city=EXCLUDED.city,email=EXCLUDED.email,phone=EXCLUDED.phone`,
        [ctx.tenantId,data.name,data.registration,data.activity,data.city,data.email,data.phone]);
    });
    return NextResponse.json({profile:data});
  } catch(error) { return jsonError(error); }
}

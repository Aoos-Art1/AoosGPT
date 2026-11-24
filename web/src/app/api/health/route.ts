import {getPool,assertRuntimeRole} from "@/lib/server/db";
import {appOrigin} from "@/lib/server/http";
export const dynamic="force-dynamic";
export async function GET() {
  let client;
  try {
    appOrigin();
    if(process.env.NODE_ENV==="production"&&process.env.TRUST_PROXY_HEADERS!=="true") throw new Error("Trusted ingress is required");
    client=await getPool().connect();
    await assertRuntimeRole(client);
    await client.query("SELECT 1 FROM tenants LIMIT 1");
    return Response.json({status:"ok"},{headers:{"Cache-Control":"no-store"}});
  } catch {
    return Response.json({status:"not_ready"},{status:503,headers:{"Cache-Control":"no-store"}});
  } finally { client?.release(); }
}

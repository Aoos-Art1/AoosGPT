import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {mkdtemp,readFile,writeFile,mkdir,rm,cp} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {createServer} from "node:net";
import {createServer as createHttpsServer} from "node:https";
import {request as upstreamRequest} from "node:http";
import {spawn,spawnSync} from "node:child_process";
import {setTimeout as wait} from "node:timers/promises";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";

// All credentials and accounts below belong to a fresh disposable test database.
// This runner never connects to DATABASE_URL supplied by the operator.
const root=path.resolve(import.meta.dirname,"..");
const browserMode=process.argv.includes("--browser");
const production=process.argv.includes("--production")||browserMode;
const secret=()=>randomBytes(32).toString("base64url");
const ownerPassword=secret(),runtimePassword=secret(),accountPassword=secret();
const scrub=text=>String(text).replaceAll(ownerPassword,"[redacted]").replaceAll(runtimePassword,"[redacted]").replaceAll(accountPassword,"[redacted]");
async function freePort(){const server=createServer();await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
const pgPort=await freePort(),webPort=await freePort(),tlsPort=browserMode?await freePort():null;
const internalOrigin=`http://127.0.0.1:${webPort}`;
const origin=browserMode?`https://127.0.0.1:${tlsPort}`:internalOrigin;
const appOrigin=browserMode?origin:production?"https://validation.example":origin;
const directory=await mkdtemp(path.join(tmpdir(),"aoos-integration-"));
let database,web,pool,tlsProxy;
let serverOutput="";
let checks=0;
const pass=message=>{checks++;console.log(`PASS ${message}`);};
const env={...process.env,DATABASE_URL:`postgresql://aoos_runtime:${runtimePassword}@127.0.0.1:${pgPort}/aoos_validation`,MIGRATION_DATABASE_URL:`postgresql://postgres:${ownerPassword}@127.0.0.1:${pgPort}/aoos_validation`,APP_ORIGIN:appOrigin,TRUST_PROXY_HEADERS:production?"true":"false",AI_API_KEY:"",AI_MODEL:"",AI_TRANSCRIPTION_MODEL:"",AZURE_SPEECH_KEY:"",AZURE_SPEECH_REGION:"",NODE_ENV:production?"production":"development",NEXT_TELEMETRY_DISABLED:"1"};
function runScript(file,args=[],input){const result=spawnSync(process.execPath,["--import","tsx",file,...args],{cwd:root,env,input,encoding:"utf8"});if(result.status!==0)throw new Error(`${file} failed: ${scrub(result.stderr||result.stdout)}`);console.log(scrub(result.stdout.trim()));}
async function request(route,{method="GET",body,cookie,requestOrigin=appOrigin,proxyIp="127.0.0.1"}={}){
  const headers={...(cookie?{Cookie:cookie}:{}),...(production&&proxyIp?{"X-Aoos-Client-IP":proxyIp}:{}),...(method!=="GET"?{Origin:requestOrigin,"Content-Type":"application/json"}:{})};
  const response=await fetch(internalOrigin+route,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:"manual",signal:AbortSignal.timeout(60_000)});
  let data;try{data=await response.json();}catch{data=null;}
  return {status:response.status,data,cookie:response.headers.get("set-cookie")?.split(";")[0],headers:response.headers};
}
async function login(email,portal="company"){const result=await request("/api/auth/login",{method:"POST",body:{email,password:accountPassword,portal}});assert.equal(result.status,200,`Login ${portal}`);assert.ok(result.cookie);assert.equal(result.data.token,undefined);return result;}
async function invite(admin,email,kind="company",tenantId,role="owner"){
  const created=await request("/api/admin/invitations",{method:"POST",cookie:admin.cookie,body:{email,name:"مستخدم اختبار",tenantName:`مساحة اختبار ${email.split("@")[0]}`,kind,role,...(tenantId?{tenantId}:{})}});
  assert.equal(created.status,201,"Invitation creation");
  const token=new URL(created.data.inviteUrl).searchParams.get("token");
  const accepted=await request("/api/auth/invite/accept",{method:"POST",body:{token,name:"مستخدم اختبار",password:accountPassword}});
  assert.equal(accepted.status,201,"Invitation acceptance");assert.ok(accepted.cookie);
  return {...accepted,invitationToken:token,email};
}
async function expectDenied(route,options,status=403){const result=await request(route,options);assert.equal(result.status,status,route);return result;}
async function sqlAs(session,fn){const client=await pool.connect();try{await client.query("BEGIN");await client.query("SELECT set_config('app.user_id',$1,true),set_config('app.tenant_id',$2,true),set_config('app.tenant_role',$3,true)",[session.userId,session.tenantId,session.tenantRole]);const result=await fn(client);await client.query("COMMIT");return result;}catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}}

try {
  database=new EmbeddedPostgres({databaseDir:path.join(directory,"pg"),user:"postgres",password:ownerPassword,port:pgPort,persistent:true,authMethod:"scram-sha-256",autoRehydrateSymlinks:true,createPostgresUser:false,postgresFlags:["-h","127.0.0.1","-c","unix_socket_directories="],onLog:()=>{},onError:()=>{}});
  await database.initialise();await database.start();await database.createDatabase("aoos_validation");
  console.log("PostgreSQL started in an isolated test cluster.");
  runScript("scripts/migrate.ts");
  runScript("scripts/migrate.ts");
  pass("Migration applies and reruns idempotently");
  runScript("scripts/create-admin.ts",["--email","admin@validation.example","--name","مدير الاختبار","--password-stdin"],accountPassword+"\n");
  pool=new pg.Pool({connectionString:env.DATABASE_URL,max:4});
  pool.on("error",error=>{console.error("Disposable test pool connection error",error.code||"unknown");});
  const role=(await pool.query("SELECT current_user,rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user")).rows[0];
  assert.equal(role.current_user,"aoos_runtime");assert.equal(role.rolsuper,false);assert.equal(role.rolbypassrls,false);
  pass("Runtime uses restricted PostgreSQL role");
  const webEnv={...env};delete webEnv.MIGRATION_DATABASE_URL;
  let serverArgs=["node_modules/next/dist/bin/next","dev","--hostname","127.0.0.1","--port",String(webPort)];
  if(production){
    await cp(path.join(root,"public"),path.join(root,".next/standalone/public"),{recursive:true});
    await cp(path.join(root,".next/static"),path.join(root,".next/standalone/.next/static"),{recursive:true});
    serverArgs=[path.join(root,".next/standalone/server.js")];webEnv.PORT=String(webPort);webEnv.HOSTNAME="127.0.0.1";
  }
  if(browserMode){
    // The browser validates the built production app over local HTTPS. This
    // disposable self-signed certificate is accepted only by the test context.
    const certificate=path.join(directory,"browser-cert.pem"),key=path.join(directory,"browser-key.pem");
    const openssl=spawnSync("openssl",["req","-x509","-newkey","rsa:2048","-nodes","-subj","/CN=127.0.0.1","-days","1","-keyout",key,"-out",certificate],{encoding:"utf8"});
    if(openssl.status!==0)throw new Error("OpenSSL could not create the disposable browser test certificate.");
    tlsProxy=createHttpsServer({key:await readFile(key),cert:await readFile(certificate)},(incoming,outgoing)=>{
      const remote=incoming.socket.remoteAddress||"127.0.0.1";
      const headers={...incoming.headers,"x-aoos-client-ip":remote,"x-forwarded-for":remote,"x-forwarded-proto":"https"};
      delete headers["x-real-ip"];
      const upstream=upstreamRequest(internalOrigin+(incoming.url||"/"),{method:incoming.method,headers},response=>{outgoing.writeHead(response.statusCode||502,response.headers);response.pipe(outgoing);});
      upstream.on("error",()=>{if(!outgoing.headersSent)outgoing.writeHead(502);outgoing.end();});
      upstream.setTimeout(65_000,()=>upstream.destroy());incoming.pipe(upstream);
    });
    await new Promise((resolve,reject)=>{tlsProxy.once("error",reject);tlsProxy.listen(tlsPort,"127.0.0.1",resolve);});
  }
  web=spawn(process.execPath,serverArgs,{cwd:root,env:webEnv,stdio:["ignore","pipe","pipe"]});
  for(const stream of [web.stdout,web.stderr]) stream.on("data",chunk=>{serverOutput=(serverOutput+scrub(chunk)).slice(-80_000);});
  const deadline=Date.now()+120_000;let ready=false;
  while(Date.now()<deadline){try{if((await fetch(internalOrigin+"/api/health",{signal:AbortSignal.timeout(5000)})).ok){ready=true;break;}}catch{}if(web.exitCode!==null)break;await wait(500);}
  assert.ok(ready,"Next.js database health must become ready");
  pass("Next.js HTTP server reaches real PostgreSQL");
  await expectDenied("/api/workspace",{},401);
  pass("Workspace API rejects unauthenticated requests");
  const admin=await login("admin@validation.example","admin");
  assert.match(admin.headers.get("set-cookie"),/httponly/i);assert.match(admin.headers.get("set-cookie"),/samesite=lax/i);
  if(production){
    assert.match(admin.cookie,/^__Host-aoos_session=/);assert.match(admin.headers.get("set-cookie"),/; Secure/i);
    assert.equal((await request("/api/auth/login",{method:"POST",proxyIp:null,body:{email:"admin@validation.example",password:accountPassword,portal:"admin"}})).status,503);
    assert.equal((await request("/api/auth/login",{method:"POST",proxyIp:"127.0.0.1, 192.0.2.1",body:{email:"admin@validation.example",password:accountPassword,portal:"admin"}})).status,503);
    pass("Production cookies are Secure/__Host and untrusted proxy configuration fails closed");
  }
  const a=await invite(admin,"owner-a@validation.example");
  const b=await invite(admin,"owner-b@validation.example");
  const individual=await invite(admin,"individual@validation.example","individual");
  const member=await invite(admin,"member@validation.example","company",a.data.session.tenantId,"member");
  const viewer=await invite(admin,"viewer@validation.example","company",a.data.session.tenantId,"viewer");
  pass("Admin invitations create separate companies, individual, member and viewer accounts");
  assert.equal((await request("/api/auth/invite/accept",{method:"POST",body:{token:a.invitationToken,name:"اختبار",password:accountPassword}})).status,400);
  pass("Invitations are one-use");
  const revoked=await request("/api/admin/invitations",{method:"POST",cookie:admin.cookie,body:{email:"revoked@validation.example",name:"دعوة ملغاة",kind:"company",role:"member",tenantId:a.data.session.tenantId}});
  assert.equal(revoked.status,201);
  assert.equal((await request(`/api/admin/invitations/${revoked.data.invitation.id}`,{method:"DELETE",cookie:admin.cookie})).status,200);
  const revokedToken=new URL(revoked.data.inviteUrl).searchParams.get("token");
  assert.equal((await request("/api/auth/invite/accept",{method:"POST",body:{token:revokedToken,name:"اختبار",password:accountPassword}})).status,400);
  const invitationPage=await request("/api/admin/invitations?limit=1&page=2",{cookie:admin.cookie});
  assert.equal(invitationPage.data.invitations.length,1);assert.equal(invitationPage.data.pagination.total,6);
  const userSearch=await request("/api/admin/users?search=owner-a",{cookie:admin.cookie});assert.equal(userSearch.data.users.length,1);
  pass("Existing-company invites omit tenantName; revocation and administrative pages work over HTTP");
  await expectDenied("/api/admin",{cookie:a.cookie});
  await expectDenied("/api/workspace",{cookie:admin.cookie});
  assert.equal((await request("/api/auth/login",{method:"POST",body:{email:a.email,password:accountPassword,portal:"admin"}})).status,401);
  assert.equal((await request("/api/auth/login",{method:"POST",body:{email:a.email,password:accountPassword,portal:"company",platformRole:"super_admin"}})).status,400);
  pass("Portal selection and forged role fields cannot elevate privileges");
  const profile={name:"شركة الاختبار ألف",registration:"",activity:"خدمات",city:"الرياض",email:"",phone:""};
  assert.equal((await request("/api/company",{method:"PATCH",cookie:a.cookie,body:profile})).status,200);
  await expectDenied("/api/company",{method:"PATCH",cookie:member.cookie,body:profile});
  await expectDenied("/api/company",{method:"PATCH",cookie:a.cookie,body:profile,requestOrigin:"https://foreign.invalid"});
  pass("Owner management and exact-origin checks enforced");
  const employeeBody={name:"موظف اختبار",job:"أخصائي",nationality:"saudi",monthlySalary:8000,documentExpiry:"2027-01-31"};
  const employee=await request("/api/employees",{method:"POST",cookie:a.cookie,body:employeeBody});assert.equal(employee.status,201);
  const aData=await request("/api/workspace",{cookie:a.cookie});const bData=await request("/api/workspace",{cookie:b.cookie});
  assert.equal(aData.data.employees.length,1);assert.equal(bData.data.employees.length,0);
  await expectDenied(`/api/employees/${employee.data.employee.id}`,{method:"DELETE",cookie:b.cookie},404);
  await expectDenied("/api/employees",{method:"POST",cookie:a.cookie,body:{...employeeBody,tenant_id:b.data.session.tenantId}},400);
  pass("Employee reads, writes and deletes stay within their tenant");
  const task=await request("/api/tasks",{method:"POST",cookie:member.cookie,body:{title:"مهمة اختبار",dueDate:"2027-02-01"}});assert.equal(task.status,201);
  assert.equal((await request(`/api/tasks/${task.data.task.id}`,{method:"PATCH",cookie:member.cookie,body:{status:"done"}})).status,200);
  await expectDenied("/api/tasks",{method:"POST",cookie:viewer.cookie,body:{title:"محظور"}});
  pass("Members can manage tasks; viewers cannot mutate");
  const letter=await request("/api/letters",{method:"POST",cookie:a.cookie,body:{title:"خطاب اختبار",recipient:"جهة اختبار",subject:"اختبار الحفظ",body:"محتوى تجريبي محلي."}});assert.equal(letter.status,201);
  assert.equal((await request("/api/letters",{cookie:member.cookie})).data.letters.length,0);
  await expectDenied(`/api/letters/${letter.data.letter.id}`,{method:"DELETE",cookie:member.cookie},404);
  pass("Letters remain private even between users in one company");
  const doc=await request("/api/knowledge",{method:"POST",cookie:a.cookie,body:{title:"إجراءات الاختبار",content:"هذا مستند اصطناعي للاختبار ولا يحتوي بيانات حقيقية."}});assert.equal(doc.status,201);
  assert.equal((await request("/api/knowledge",{cookie:b.cookie})).data.documents.length,0);
  await expectDenied("/api/knowledge",{method:"POST",cookie:member.cookie,body:{title:"اختبار",content:"اختبار"}});
  pass("Company knowledge is isolated and managed by authorized roles");
  await request("/api/memories",{method:"PATCH",cookie:a.cookie,body:{memoryEnabled:true}});
  const memory=await request("/api/memories",{method:"POST",cookie:a.cookie,body:{content:"تفضيل اصطناعي للاختبار"}});assert.equal(memory.status,201);
  assert.equal((await request("/api/memories",{cookie:member.cookie})).data.memories.length,0);
  assert.equal((await request(`/api/memories/${memory.data.memory.id}`,{method:"PATCH",cookie:a.cookie,body:{content:"تفضيل محدّث للاختبار"}})).status,200);
  assert.equal((await request(`/api/memories/${memory.data.memory.id}`,{method:"DELETE",cookie:a.cookie})).status,200);
  await request("/api/memories",{method:"PATCH",cookie:a.cookie,body:{memoryEnabled:false}});
  assert.equal((await request("/api/memories",{cookie:a.cookie})).data.memories.length,0);
  pass("Memory consent, private ownership, edit and delete work over HTTP");
  const caps=await request("/api/capabilities",{cookie:a.cookie});assert.deepEqual(caps.data,{chat:false,transcription:false,speech:false,speechLocale:null});
  const chat=await request("/api/chat",{method:"POST",cookie:a.cookie,body:{message:"اختبار"}});assert.equal(chat.status,503);assert.equal(chat.data.error.code,"AI_NOT_CONFIGURED");
  await expectDenied("/api/chat",{method:"POST",cookie:viewer.cookie,body:{message:"اختبار"}});
  pass("Unconfigured AI is reported honestly; viewers cannot incur provider calls");
  assert.equal((await pool.query("SELECT * FROM employees")).rowCount,0);
  await sqlAs(a.data.session,async client=>assert.equal((await client.query("SELECT * FROM employees")).rowCount,1));
  assert.equal((await pool.query("SELECT * FROM employees")).rowCount,0);
  await assert.rejects(sqlAs(a.data.session,client=>client.query("INSERT INTO employees(tenant_id,name,nationality) VALUES($1,'invalid','saudi')",[b.data.session.tenantId])),error=>error.code==="42501");
  pass("RLS blocks omitted filters, tenant forgery and pooled context leakage");
  await assert.rejects(pool.query("UPDATE users SET platform_role='super_admin' WHERE id=$1",[a.data.session.userId]),error=>error.code==="42501");
  pass("Runtime SQL cannot promote a platform administrator");
  const bConversation=await sqlAs(b.data.session,async client=>(await client.query("INSERT INTO conversations(tenant_id,user_id,title) VALUES($1,$2,'private') RETURNING id",[b.data.session.tenantId,b.data.session.userId])).rows[0].id);
  await sqlAs(b.data.session,async client=>{
    const common=[b.data.session.tenantId,b.data.session.userId,bConversation];
    await client.query("INSERT INTO messages(id,tenant_id,user_id,conversation_id,role,content) VALUES('ffffffff-ffff-4fff-8fff-ffffffffffff',$1,$2,$3,'user','السؤال')",common);
    await client.query("INSERT INTO messages(id,tenant_id,user_id,conversation_id,role,content) VALUES('00000000-0000-4000-8000-000000000000',$1,$2,$3,'assistant','الإجابة')",common);
  });
  const ordered=await request(`/api/conversations/${bConversation}`,{cookie:b.cookie});assert.equal(ordered.status,200);assert.deepEqual(ordered.data.messages.map(item=>item.role),["user","assistant"]);
  await assert.rejects(sqlAs(b.data.session,client=>client.query("UPDATE messages SET sequence_no=DEFAULT WHERE conversation_id=$1",[bConversation])),error=>error.code==="42501");
  pass("Equal-timestamp messages retain turn order and runtime cannot alter their sequence");
  await expectDenied(`/api/conversations/${bConversation}`,{cookie:a.cookie},404);
  pass("Forged conversation IDs reveal no other tenant history");
  await request(`/api/admin/users/${viewer.data.session.userId}`,{method:"PATCH",cookie:admin.cookie,body:{disabled:true}});
  await expectDenied("/api/workspace",{cookie:viewer.cookie},401);
  await request(`/api/admin/tenants/${b.data.session.tenantId}`,{method:"PATCH",cookie:admin.cookie,body:{status:"suspended"}});
  await expectDenied("/api/workspace",{cookie:b.cookie},401);
  pass("Disabling users and suspending companies revoke access immediately");
  const individualCookie=individual.cookie;
  assert.equal((await request("/api/auth/logout",{method:"POST",cookie:individualCookie})).status,200);
  await expectDenied("/api/workspace",{cookie:individualCookie},401);
  pass("Logout revokes a replayed session cookie");
  if(browserMode) {
    // Re-enable this synthetic account after the revocation assertion above so
    // browser checks can exercise the genuine read-only UI with a fresh login.
    assert.equal((await request(`/api/admin/users/${viewer.data.session.userId}`,{method:"PATCH",cookie:admin.cookie,body:{disabled:false}})).status,200);
    await mkdir(path.join(root,".local"),{recursive:true});
    const fixtureFile=path.join(root,".local","integration-fixtures.json");
    await writeFile(fixtureFile,JSON.stringify({origin,email:a.email,viewerEmail:viewer.email,adminEmail:"admin@validation.example",tenantId:a.data.session.tenantId,password:accountPassword}),{mode:0o600});
    const browser=spawn(process.execPath,["node_modules/@playwright/test/cli.js","test"],{cwd:root,env:{...env,AOOS_BASE_URL:origin,AOOS_TEST_FIXTURES:fixtureFile,AOOS_LOCAL_TLS:"1"},stdio:["ignore","pipe","pipe"]});
    let pending="",diagnostics="";
    browser.stdout.on("data",chunk=>{pending+=String(chunk);const lines=pending.split("\n");pending=lines.pop();for(const line of lines)console.log(scrub(line));});
    browser.stderr.on("data",chunk=>{diagnostics=(diagnostics+String(chunk)).slice(-20_000);});
    const browserTimeout=setTimeout(()=>browser.kill("SIGTERM"),12*60_000);
    const status=await new Promise((resolve,reject)=>{browser.once("error",reject);browser.once("close",resolve);}).finally(async()=>{clearTimeout(browserTimeout);await rm(fixtureFile,{force:true});});
    if(pending)console.log(scrub(pending));
    if(status!==0) throw new Error(`Browser tests failed: ${scrub(diagnostics)}`);
    pass("Desktop, mobile, keyboard and authenticated browser flows");
  }
  console.log(`Integration complete: ${checks} scenario groups passed. No live AI provider calls were made.`);
} catch(error) {
  console.error(scrub(error?.stack||error));
  if(serverOutput) console.error("Last application diagnostics:\n"+serverOutput.slice(-5000));
  process.exitCode=1;
} finally {
  if(tlsProxy){tlsProxy.closeAllConnections();await new Promise(resolve=>tlsProxy.close(resolve));}
  if(web&&web.exitCode===null){web.kill("SIGTERM");await Promise.race([new Promise(resolve=>web.once("exit",resolve)),wait(5000)]);if(web.exitCode===null){web.kill("SIGKILL");await Promise.race([new Promise(resolve=>web.once("exit",resolve)),wait(2000)]);}}
  await pool?.end();
  await database?.stop().catch(()=>{});
  await rm(directory,{recursive:true,force:true});
}

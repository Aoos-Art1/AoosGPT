"use client";
import {useState} from "react";
import {Ban,RefreshCw} from "lucide-react";
import {api,errorMessage,shortDate} from "@/lib/client";
import {Badge,Button,CardHeading,Notice} from "./ui";
import {AdminPager,AdminSearch,useAdminPage} from "./admin-pagination";

interface Invitation {id:string;email:string;tenantName:string;role:string;expiresAt:string;status:"pending"|"used"|"revoked"|"expired"}
const statusLabels={pending:"قيد الانتظار",used:"مستخدمة",revoked:"ملغاة",expired:"منتهية"};
export function PendingInvitations({revision,onChange}:{revision:number;onChange:()=>Promise<void>}) {
  const [localRevision,setLocalRevision]=useState(0);
  const page=useAdminPage<Invitation>("invitations",revision+localRevision);
  const [error,setError]=useState("");
  const [busy,setBusy]=useState<string|null>(null);
  function refresh(){setLocalRevision(value=>value+1);setError("");}
  async function revoke(item:Invitation){
    if(!window.confirm(`إلغاء دعوة ${item.email}؟ سيتوقف رابطها عن العمل.`))return;
    setBusy(item.id);setError("");
    try {await api(`/api/admin/invitations/${item.id}`,{method:"DELETE"});refresh();await onChange();}
    catch(failure){setError(errorMessage(failure));}
    finally{setBusy(null);}
  }
  return <section className="card mt-6"><div className="card-pad pb-0"><CardHeading title="الدعوات" description="ابحث في جميع الدعوات وألغِ الروابط المعلقة عند الحاجة." action={<Button variant="ghost" onClick={refresh} aria-label="تحديث الدعوات"><RefreshCw size={14}/></Button>}/><AdminSearch label="البحث في الدعوات" onSearch={page.applySearch}/>{(error||page.error)&&<Notice kind="error">{error||page.error}</Notice>}</div><div className="table-scroll"><table className="data-table"><thead><tr><th>البريد الإلكتروني</th><th>المساحة</th><th>الحالة</th><th>تنتهي في</th><th>الإجراء</th></tr></thead><tbody>{page.items.map(item=><tr key={item.id}><td dir="ltr">{item.email}</td><td>{item.tenantName}</td><td><Badge color={item.status==="pending"?"gold":"gray"}>{statusLabels[item.status]}</Badge></td><td>{shortDate(item.expiresAt)}</td><td>{item.status==="pending"?<Button variant="danger" disabled={!!busy} onClick={()=>void revoke(item)}><Ban size={13}/>إلغاء الدعوة</Button>:"—"}</td></tr>)}{page.items.length===0&&<tr><td colSpan={5} className="text-center">{page.loading?"جارٍ تحميل الدعوات...":"لا توجد دعوات مطابقة."}</td></tr>}</tbody></table></div><AdminPager label="الدعوات" pagination={page.pagination} onPage={page.setPage}/></section>;
}

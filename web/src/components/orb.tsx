import { Sparkles, ShieldCheck } from "lucide-react";

export function SaudOrb() {
  return <div className="saud-orb" aria-hidden="true"><div className="orb-ring second" /><div className="orb-ring" /><div className="orb-core"><Sparkles size={66} strokeWidth={1.15} /></div><div className="orb-label"><ShieldCheck size={13} />أعمالك، بوضوح أكثر</div></div>;
}

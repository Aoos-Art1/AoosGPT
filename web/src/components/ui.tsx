"use client";

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { LoaderCircle, Sparkles, ArrowUpLeft, Check, X } from "lucide-react";
import Link from "next/link";
import { Button as StyledButton } from "@/components/ui/button";

const buttonVariant = { primary: "default", secondary: "secondary", ghost: "ghost", danger: "destructive" } as const;

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; busy?: boolean }>(function Button({ className = "", variant = "primary", busy, disabled, children, ...props }, ref) {
  return <StyledButton ref={ref} variant={buttonVariant[variant]} className={className} disabled={disabled || busy} aria-busy={busy || undefined} {...props}>{busy && <LoaderCircle size={17} className="animate-spin" />}{children}</StyledButton>;
});

export function Brand({ compact = false, href = "/" }: { compact?: boolean; href?: string }) {
  return <Link href={href} className={`brand ${compact ? "brand-compact" : ""}`} aria-label="سعود — الصفحة الرئيسية"><span className="brand-mark" aria-hidden="true"><Sparkles size={24} strokeWidth={1.6} /></span><span><strong>سعود<span className="brand-dot">.</span></strong>{!compact && <small>مساعدك للأعمال الحكومية</small>}</span></Link>;
}

export function Badge({ children, color = "green" }: { children: ReactNode; color?: "green" | "gold" | "gray" }) { return <span className={`badge badge-${color}`}>{children}</span>; }
export function EmptyState({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children?: ReactNode }) {
  return <div className="empty-state"><span className="empty-icon">{icon}</span><h3>{title}</h3><p>{description}</p>{children}</div>;
}
export function SectionHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="section-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</div>;
}
export function CardHeading({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="card-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>;
}
export function Notice({ children, kind = "info" }: { children: ReactNode; kind?: "info" | "error" | "success" }) { return <div role={kind === "error" ? "alert" : "status"} className={`notice notice-${kind}`}>{children}</div>; }
export function ArrowLink({ href, children }: { href: string; children: ReactNode }) { return <Link className="arrow-link" href={href}>{children}<ArrowUpLeft size={16} /></Link>; }
export function Toast({ notice, dismiss }: { notice: { message: string; error?: boolean } | null; dismiss: () => void }) {
  return <div className="toast-region" aria-live="polite">{notice && <div className={`toast ${notice.error ? "toast-error" : ""}`}><span>{notice.error ? <X size={18} /> : <Check size={18} />}</span><p>{notice.message}</p><button onClick={dismiss} aria-label="إغلاق الإشعار"><X size={16} /></button></div>}</div>;
}

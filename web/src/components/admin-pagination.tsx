"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { api, errorMessage, number } from "@/lib/client";
import type { PageMeta } from "@/lib/admin-contracts";
import { Button } from "./ui";

export function useAdminPage<T>(collection: "users" | "tenants" | "invitations", revision: number) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const key = `${collection}:${page}:${search}:${revision}`;
  const [result, setResult] = useState<{ key: string; items: T[]; pagination: PageMeta } | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ page: String(page), limit: "25", search });
    api<Record<string, T[]> & { pagination: PageMeta }>(`/api/admin/${collection}?${params}`, { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) { setResult({ key, items: data[collection], pagination: data.pagination }); setError(null); } })
      .catch((failure) => { if (!controller.signal.aborted) setError({ key, message: errorMessage(failure) }); });
    return () => controller.abort();
  }, [collection, page, search, key]);
  return {
    items: result?.key === key ? result.items : [],
    pagination: result?.key === key ? result.pagination : null,
    error: error?.key === key ? error.message : "",
    loading: result?.key !== key && error?.key !== key,
    setPage,
    applySearch(value: string) { setSearch(value.trim()); setPage(1); },
  };
}

export function AdminSearch({ label, onSearch }: { label: string; onSearch: (value: string) => void }) {
  const [query, setQuery] = useState("");
  function submit(event: FormEvent) { event.preventDefault(); onSearch(query); }
  return <form className="filter-bar" onSubmit={submit}><div className="filter-search"><Search size={16} /><input className="field" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={label} aria-label={label} maxLength={120} /></div><Button variant="secondary">بحث</Button></form>;
}

export function AdminPager({ pagination, onPage, label }: { pagination: PageMeta | null; onPage: (page: number) => void; label: string }) {
  if (!pagination) return null;
  return <nav className="flex flex-wrap items-center justify-between gap-3 p-5 text-xs text-muted" aria-label={`صفحات ${label}`}><span>{number(pagination.total)} سجل · الصفحة {number(pagination.totalPages ? pagination.page : 0)} من {number(pagination.totalPages)}</span><div className="flex gap-2"><Button variant="ghost" disabled={pagination.page <= 1} onClick={() => onPage(pagination.page - 1)} aria-label={`الصفحة السابقة من ${label}`}><ChevronRight size={14} />السابق</Button><Button variant="ghost" disabled={pagination.page >= pagination.totalPages} onClick={() => onPage(pagination.page + 1)} aria-label={`الصفحة التالية من ${label}`}>التالي<ChevronLeft size={14} /></Button></div></nav>;
}

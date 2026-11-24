"use client";

import { createContext, useContext } from "react";
import type { TenantSession, WorkspaceData } from "@/lib/contracts";

export interface WorkspaceContextValue {
  data: WorkspaceData;
  demo: boolean;
  session: TenantSession | null;
  base: string;
  canWrite: boolean;
  busy: string | null;
  refresh: () => Promise<void>;
  notify: (message: string, error?: boolean) => void;
  mutate: (path: string, method: string, payload: unknown, update: (data: WorkspaceData) => WorkspaceData, success?: string) => Promise<boolean>;
}

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("Workspace context is missing");
  return context;
}

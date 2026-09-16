/** Typed IPC client. All calls carry the session token (except setup/login). */

declare global {
  interface Window {
    merqo: {
      invoke: (action: string, args?: Record<string, unknown>, token?: string) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
      dialog: (kind: string, options?: Record<string, unknown>) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
      shell: (action: string, target: string) => Promise<{ ok: boolean; error?: string }>;
      printers: () => Promise<{ ok: boolean; data?: unknown; error?: string }>;
      print: (payload: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
      pdf: (payload: Record<string, unknown>) => Promise<{ ok: boolean; data?: unknown; error?: string }>;
      preview: (payload: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>;
      version: string;
    };
  }
}

let token: string | null = sessionStorage.getItem('merqo_token');

export function setToken(t: string | null): void {
  token = t;
  if (t) sessionStorage.setItem('merqo_token', t);
  else sessionStorage.removeItem('merqo_token');
}

export function getToken(): string | null {
  return token;
}

export class ApiError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

export async function call<T = unknown>(action: string, args?: Record<string, unknown>, opts?: { noAuth?: boolean }): Promise<T> {
  const res = await window.merqo.invoke(action, args ?? {}, opts?.noAuth ? undefined : token ?? undefined);
  if (!res.ok) throw new ApiError(res.error || 'DB_ERROR');
  return res.data as T;
}

export const api = {
  dialog: (kind: string, options?: Record<string, unknown>) => window.merqo.dialog(kind, options),
  shell: (action: string, target: string) => window.merqo.shell(action, target),
  printers: () => window.merqo.printers(),
  print: (payload: Record<string, unknown>) => window.merqo.print(payload),
  pdf: (payload: Record<string, unknown>) => window.merqo.pdf(payload),
  preview: (payload: Record<string, unknown>) => window.merqo.preview(payload),
};

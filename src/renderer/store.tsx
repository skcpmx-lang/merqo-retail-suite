import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { call, setToken, getToken, ApiError } from './api';
import { bnError } from '@shared/bn';
import { formatMoney } from '@shared/money';
import type { Business, Session, UserSafe } from '@shared/types';
import { CheckCircle2, AlertTriangle } from 'lucide-react';

interface Toast {
  id: number;
  kind: 'success' | 'error';
  message: string;
}

interface AppState {
  sessionChecked: boolean;
  setupComplete: boolean | null;
  user: UserSafe | null;
  business: Business | null;
  permissions: string[];
  toasts: Toast[];
  can: (perm: string) => boolean;
  notify: (kind: 'success' | 'error', message: string) => void;
  fail: (e: unknown) => void;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
  setSetupComplete: (v: boolean) => void;
  dismissToast: (id: number) => void;
}

const Ctx = createContext<AppState | null>(null);

let toastId = 1;

export function AppProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [sessionChecked, setSessionChecked] = useState(false);
  const [setupComplete, setSetupComplete] = useState<boolean | null>(null);
  const [user, setUser] = useState<UserSafe | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const lockTimer = useRef<number | null>(null);

  const dismissToast = useCallback((id: number) => {
    setToasts((t) => t.filter((x) => x.id !== id));
  }, []);

  const notify = useCallback((kind: 'success' | 'error', message: string) => {
    const id = toastId++;
    setToasts((t) => [...t.slice(-3), { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 6000 : 3500);
  }, []);

  const fail = useCallback((e: unknown) => {
    if (e instanceof ApiError) {
      if (e.code === 'NOT_AUTHENTICATED') {
        setToken(null);
        setUser(null);
        return;
      }
      notify('error', bnError(e.code));
    } else {
      notify('error', bnError(String(e)));
    }
  }, [notify]);

  const applySession = useCallback((s: Session) => {
    setToken(s.token);
    setUser(s.user);
    setBusiness(s.business);
    setPermissions(s.permissions);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const s = await call<Session>('auth.login', { username, password }, { noAuth: true });
    applySession(s);
  }, [applySession]);

  const logout = useCallback(async () => {
    try {
      await call('auth.logout');
    } catch { /* noop */ }
    setToken(null);
    setUser(null);
    setPermissions([]);
  }, []);

  const refreshMe = useCallback(async () => {
    if (!getToken()) return;
    try {
      const me = await call<{ business: Business | null; permissions: string[]; user: UserSafe }>('auth.me');
      setBusiness(me.business);
      setPermissions(me.permissions);
      setUser(me.user);
    } catch {
      setToken(null);
      setUser(null);
    }
  }, []);

  // Auto-lock after 15 min inactivity (configurable later): reset timer on activity
  useEffect(() => {
    if (!user) return;
    const reset = (): void => {
      if (lockTimer.current) window.clearTimeout(lockTimer.current);
      lockTimer.current = window.setTimeout(() => {
        logout();
        notify('error', 'দীর্ঘক্ষণ নিষ্ক্রিয় থাকায় স্বয়ংক্রিয়ভাবে লক করা হয়েছে। আবার লগইন করুন।');
      }, 15 * 60 * 1000);
    };
    reset();
    const events = ['mousemove', 'keydown', 'click'];
    events.forEach((e) => window.addEventListener(e, reset));
    return () => {
      if (lockTimer.current) window.clearTimeout(lockTimer.current);
      events.forEach((e) => window.removeEventListener(e, reset));
    };
  }, [user, logout, notify]);

  useEffect(() => {
    (async () => {
      try {
        const st = await call<{ complete: boolean }>('setup.status', {}, { noAuth: true });
        setSetupComplete(st.complete);
        if (st.complete && getToken()) await refreshMe();
      } catch {
        setSetupComplete(false);
      } finally {
        setSessionChecked(true);
      }
    })();
  }, [refreshMe]);

  const can = useCallback((perm: string) => permissions.includes(perm), [permissions]);

  const value = useMemo<AppState>(() => ({
    sessionChecked, setupComplete, user, business, permissions, toasts,
    can, notify, fail, login, logout, refreshMe, setSetupComplete, dismissToast,
  }), [sessionChecked, setupComplete, user, business, permissions, toasts, can, notify, fail, login, logout, refreshMe]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="mq-toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`mq-toast ${t.kind}`} onClick={() => dismissToast(t.id)}>
            {t.kind === 'success' ? <CheckCircle2 /> : <AlertTriangle />}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error('AppProvider missing');
  return v;
}

/** Money formatting honoring business digit locale. */
export function useMoney(): { fmt: (paisa: number) => string; bnDigits: boolean } {
  const { business } = useApp();
  const bnDigits = business?.digit_locale === 'bn';
  return useMemo(() => ({
    bnDigits,
    fmt: (paisa: number) => formatMoney(paisa ?? 0, { useBnDigits: bnDigits }),
  }), [bnDigits]);
}

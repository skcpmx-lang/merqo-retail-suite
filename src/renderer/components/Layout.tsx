import React, { useEffect, useRef, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, ShoppingCart, ShoppingBag, Package, Users, Truck, Wallet,
  Landmark, BarChart3, Bell, UserCog, Settings, ChevronsLeft, ChevronsRight,
  Search, LogOut, Lock,
} from 'lucide-react';
import { useApp } from '../store';
import { call } from '../api';
import { roleName } from '@shared/constants';
import { Modal } from './ui';

const NAV = [
  { to: '/', label: 'ড্যাশবোর্ড', icon: <LayoutDashboard />, end: true },
  { to: '/sales', label: 'বিক্রয়', icon: <ShoppingCart /> },
  { to: '/purchases', label: 'ক্রয়', icon: <ShoppingBag /> },
  { to: '/products', label: 'পণ্য ও স্টক', icon: <Package /> },
  { to: '/customers', label: 'কাস্টমার', icon: <Users /> },
  { to: '/suppliers', label: 'সরবরাহকারী', icon: <Truck /> },
  { to: '/accounts', label: 'হিসাব', icon: <Wallet /> },
  { to: '/agent', label: 'এজেন্ট ব্যাংকিং', icon: <Landmark /> },
  { to: '/reports', label: 'রিপোর্ট', icon: <BarChart3 /> },
  { to: '/notifications', label: 'নোটিফিকেশন', icon: <Bell /> },
  { to: '/employees', label: 'কর্মচারী', icon: <UserCog /> },
  { to: '/settings', label: 'সেটিংস', icon: <Settings /> },
];

export function Layout({ children, title, sub }: { children: React.ReactNode; title: string; sub?: string }): React.ReactElement {
  const { user, business, logout, can } = useApp();
  const [collapsed, setCollapsed] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const navigate = useNavigate();

  const visibleNav = NAV.filter((n) => {
    if (n.to === '/employees') return can('user.manage') || can('audit.view');
    if (n.to === '/settings') return true;
    return true;
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await call<{ unread: number }>('notif.list', { opts: { page: 1, pageSize: 1 } }) as unknown as { unread: number };
        if (alive && typeof r.unread === 'number') setUnread(r.unread);
      } catch { /* noop */ }
    })();
    const t = setInterval(async () => {
      try {
        const r = await call<{ unread: number }>('notif.list', { opts: { page: 1, pageSize: 1 } }) as unknown as { unread: number };
        if (alive && typeof r.unread === 'number') setUnread(r.unread);
      } catch { /* noop */ }
    }, 60000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'F1') { e.preventDefault(); setSearchOpen(true); }
      else if (e.key === 'F2') { e.preventDefault(); navigate('/sales'); }
      else if (e.key === 'F3') { e.preventDefault(); navigate('/products?new=1'); }
      else if (e.key === 'F4') { e.preventDefault(); navigate('/customers'); }
      else if (e.key === 'F5' && e.ctrlKey === false) { /* allow default refresh? prevent accidental: keep default */ }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  const todayStr = new Date().toLocaleDateString('bn-BD', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  return (
    <div className="mq-shell">
      <aside className={`mq-sidebar${collapsed ? ' collapsed' : ''}`}>
        <div className="mq-brand">
          <div className="mq-brand-mark">M</div>
          <div className="mq-brand-text">
            <div className="mq-brand-name">MERQO.</div>
            <div className="mq-brand-sub">Retail Suite</div>
          </div>
        </div>
        <nav className="mq-nav">
          {visibleNav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} title={n.label} className={({ isActive }) => `mq-nav-item${isActive ? ' active' : ''}`}>
              {n.icon}
              <span>{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="mq-sidebar-foot">
          <div className="mq-user-chip" title={user?.name}>
            <div className="mq-user-avatar">{user?.name?.slice(0, 1) ?? 'ব'}</div>
            <div className="mq-user-meta">
              <div className="mq-user-name">{user?.name}</div>
              <div className="mq-user-role">{roleName(user?.role ?? '')}</div>
            </div>
          </div>
          <div className="mq-flex mq-mt" style={{ gap: 6 }}>
            <button className="mq-icon-btn" title={collapsed ? 'সাইডবার বড় করুন' : 'সাইডবার ছোট করুন'} onClick={() => setCollapsed(!collapsed)} style={{ flex: 1 }}>
              {collapsed ? <ChevronsRight /> : <ChevronsLeft />}
            </button>
            <button className="mq-icon-btn" title="লগআউট" onClick={logout} style={{ flex: 1 }}>
              <LogOut />
            </button>
          </div>
        </div>
      </aside>
      <div className="mq-main">
        <header className="mq-topbar">
          <div>
            <div className="mq-topbar-title">{business?.name || title}</div>
            <div className="mq-topbar-sub">{title}{sub ? ` • ${sub}` : ''} • {todayStr}</div>
          </div>
          <div className="mq-topbar-spacer" />
          <button className="mq-icon-btn" title="খুঁজুন (F1)" onClick={() => setSearchOpen(true)}>
            <Search />
          </button>
          <button className="mq-icon-btn" title="নোটিফিকেশন" onClick={() => navigate('/notifications')}>
            <Bell />
            {unread > 0 && <span className="mq-dot">{unread > 99 ? '৯৯+' : unread}</span>}
          </button>
          <button className="mq-icon-btn" title="লক করুন" onClick={logout}>
            <Lock />
          </button>
        </header>
        <main className="mq-content">
          <div className="mq-page wide">{children}</div>
        </main>
      </div>
      {searchOpen && <GlobalSearch onClose={() => setSearchOpen(false)} />}
    </div>
  );
}

function GlobalSearch({ onClose }: { onClose: () => void }): React.ReactElement {
  const [q, setQ] = useState('');
  const [res, setRes] = useState<{ products: Record<string, unknown>[]; customers: Record<string, unknown>[]; suppliers: Record<string, unknown>[]; invoices: Record<string, unknown>[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return; }
    const t = setTimeout(async () => {
      try {
        const r = await call<typeof res>('search.global', { q: q.trim() });
        setRes(r);
      } catch { /* noop */ }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const go = (path: string): void => { onClose(); navigate(path); };

  return (
    <Modal title="সার্চ" sub="পণ্য, কাস্টমার, সরবরাহকারী, ইনভয়েস খুঁজুন" onClose={onClose}>
      <input ref={inputRef} className="mq-input" placeholder="কমপক্ষে ২ অক্ষর লিখুন…" value={q} onChange={(e) => setQ(e.target.value)} />
      {res && (
        <div style={{ marginTop: 12, maxHeight: 380, overflowY: 'auto' }}>
          {(res.products as Record<string, unknown>[]).length > 0 && (
            <>
              <p className="mq-small mq-muted" style={{ margin: '8px 0 4px', fontWeight: 700 }}>পণ্য</p>
              {(res.products as Record<string, unknown>[]).map((p) => (
                <div key={String(p.id)} className="mq-list-row" style={{ cursor: 'pointer' }} onClick={() => go(`/products?q=${encodeURIComponent(String(p.name))}`)}>
                  <div><div style={{ fontWeight: 700 }}>{String(p.name)}</div><div className="mq-small mq-muted">{String(p.barcode || p.sku || '')}</div></div>
                </div>
              ))}
            </>
          )}
          {(res.customers as Record<string, unknown>[]).length > 0 && (
            <>
              <p className="mq-small mq-muted" style={{ margin: '8px 0 4px', fontWeight: 700 }}>কাস্টমার</p>
              {(res.customers as Record<string, unknown>[]).map((c) => (
                <div key={String(c.id)} className="mq-list-row" style={{ cursor: 'pointer' }} onClick={() => go(`/customers?id=${String(c.id)}`)}>
                  <div><div style={{ fontWeight: 700 }}>{String(c.name)}</div><div className="mq-small mq-muted">{String(c.phone || '')}</div></div>
                </div>
              ))}
            </>
          )}
          {(res.suppliers as Record<string, unknown>[]).length > 0 && (
            <>
              <p className="mq-small mq-muted" style={{ margin: '8px 0 4px', fontWeight: 700 }}>সরবরাহকারী</p>
              {(res.suppliers as Record<string, unknown>[]).map((s) => (
                <div key={String(s.id)} className="mq-list-row" style={{ cursor: 'pointer' }} onClick={() => go(`/suppliers?id=${String(s.id)}`)}>
                  <div><div style={{ fontWeight: 700 }}>{String(s.name)}</div><div className="mq-small mq-muted">{String(s.phone || '')}</div></div>
                </div>
              ))}
            </>
          )}
          {(res.invoices as Record<string, unknown>[]).length > 0 && (
            <>
              <p className="mq-small mq-muted" style={{ margin: '8px 0 4px', fontWeight: 700 }}>ইনভয়েস</p>
              {(res.invoices as Record<string, unknown>[]).map((s) => (
                <div key={String(s.id)} className="mq-list-row" style={{ cursor: 'pointer' }} onClick={() => go(`/sales?invoice=${String(s.id)}`)}>
                  <div><div style={{ fontWeight: 700 }}>{String(s.invoice_no)}</div></div>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </Modal>
  );
}

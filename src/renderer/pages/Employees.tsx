import React, { useCallback, useEffect, useState } from 'react';
import { UserCog, Plus, Pencil, Trash2, ShieldCheck, ScrollText, Search } from 'lucide-react';
import { Layout } from '../components/Layout';
import { PageHeader, Modal, EmptyState, Badge, Pagination, Field, Spinner, useDebouncedValue, Confirm } from '../components/ui';
import { useDateRange } from '../components/DateRange';
import { call } from '../api';
import { useApp } from '../store';
import { ROLES, PERMISSIONS, PERMISSION_BN, PermissionKey, Role } from '@shared/constants';
import type { Paged, UserSafe } from '@shared/types';

export function Employees(): React.ReactElement {
  const { can } = useApp();
  const [tab, setTab] = useState<'users' | 'roles' | 'audit'>('users');

  if (!can('user.manage') && !can('audit.view')) {
    return <Layout title="কর্মচারী"><div className="mq-alert warn">এই পেজটি দেখার অনুমতি আপনার নেই।</div></Layout>;
  }

  return (
    <Layout title="কর্মচারী" sub="ব্যবহারকারী, ভূমিকা ও অডিট লগ">
      <div className="mq-tabs">
        {can('user.manage') && <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}><UserCog /> ব্যবহারকারী</button>}
        {can('permission.manage') && <button className={tab === 'roles' ? 'active' : ''} onClick={() => setTab('roles')}><ShieldCheck /> ভূমিকা ও অনুমতি</button>}
        {can('audit.view') && <button className={tab === 'audit' ? 'active' : ''} onClick={() => setTab('audit')}><ScrollText /> অডিট লগ</button>}
      </div>
      {tab === 'users' && can('user.manage') && <UserList />}
      {tab === 'roles' && can('permission.manage') && <RoleMatrix />}
      {tab === 'audit' && can('audit.view') && <AuditList />}
    </Layout>
  );
}

function UserList(): React.ReactElement {
  const { fail, notify, user: me } = useApp();
  const [data, setData] = useState<Paged<UserSafe>>({ rows: [], total: 0, page: 1, pageSize: 50 });
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<UserSafe | null>(null);
  const [deleting, setDeleting] = useState<UserSafe | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call<Paged<UserSafe>>('user.list', { opts: { page: 1, pageSize: 100 } });
      setData(r);
    } catch (e) { fail(e); }
    finally { setLoading(false); }
  }, [fail]);

  useEffect(() => { load(); }, [load]);

  const roleBn = (r: string): string => ROLES.find((x) => x.id === r)?.bn || r;

  return (
    <div>
      <PageHeader title="ব্যবহারকারী" sub={`${data.total} জন`}>
        <button className="mq-btn primary" onClick={() => { setEditing(null); setFormOpen(true); }}><Plus /> নতুন ব্যবহারকারী</button>
      </PageHeader>
      {loading ? <Spinner /> : (
        <div className="mq-table-wrap">
          <table className="mq-table">
            <thead><tr><th>নাম</th><th>ইউজারনাম</th><th>মোবাইল</th><th>ভূমিকা</th><th>অবস্থা</th><th>শেষ লগইন</th><th className="center">কার্যক্রম</th></tr></thead>
            <tbody>
              {data.rows.map((u) => (
                <tr key={u.id}>
                  <td><strong>{u.name}</strong>{me?.id === u.id && <Badge tone="blue">আপনি</Badge>}</td>
                  <td className="mq-mono">{u.username}</td>
                  <td>{u.phone || '—'}</td>
                  <td><Badge tone="violet">{roleBn(u.role)}</Badge></td>
                  <td>{u.active ? <Badge tone="green">সক্রিয়</Badge> : <Badge tone="gray">নিষ্ক্রিয়</Badge>}</td>
                  <td>{u.last_login_at ? new Date(u.last_login_at).toLocaleString('bn-BD') : '—'}</td>
                  <td><div className="mq-row-actions">
                    <button className="mq-mini-btn" onClick={() => { setEditing(u); setFormOpen(true); }}><Pencil /></button>
                    <button className="mq-mini-btn danger" onClick={() => setDeleting(u)}><Trash2 /></button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {formOpen && <UserForm initial={editing} onClose={() => { setFormOpen(false); setEditing(null); }} onSaved={() => { setFormOpen(false); setEditing(null); load(); notify('success', 'তথ্য সংরক্ষণ করা হয়েছে।'); }} />}
      {deleting && (
        <Confirm title="ব্যবহারকারী মুছুন" message={`“${deleting.name}” অ্যাকাউন্টটি মুছে ফেলা হবে। লেনদেনের ইতিহাস থাকলে অ্যাকাউন্টটি মুছে না ফেলে নিষ্ক্রিয় করা হবে।`} danger
          onCancel={() => setDeleting(null)} busy={busy} onConfirm={async () => {
            setBusy(true);
            try { await call('user.delete', { id: deleting.id }); notify('success', 'ব্যবস্থা নেওয়া হয়েছে।'); setDeleting(null); load(); } catch (e) { fail(e); }
            finally { setBusy(false); }
          }} />
      )}
    </div>
  );
}

function UserForm({ initial, onClose, onSaved }: { initial: UserSafe | null; onClose: () => void; onSaved: () => void }): React.ReactElement {
  const { fail } = useApp();
  const [f, setF] = useState({
    name: initial?.name || '', username: initial?.username || '', phone: initial?.phone || '',
    role: initial?.role || 'cashier', active: initial ? !!initial.active : true, password: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (): Promise<void> => {
    if (!f.name.trim() || !f.username.trim()) { setError('নাম ও ইউজারনাম আবশ্যক।'); return; }
    if (!initial && f.password.length < 6) { setError('পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।'); return; }
    setBusy(true);
    try {
      if (initial) {
        await call('user.update', {
          id: initial.id,
          input: { name: f.name.trim(), phone: f.phone.trim() || null, role: f.role, active: f.active, ...(f.password ? { password: f.password } : {}) },
        });
      } else {
        await call('user.create', { input: { name: f.name.trim(), username: f.username.trim(), password: f.password, phone: f.phone.trim() || null, role: f.role } });
      }
      onSaved();
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={initial ? 'ব্যবহারকারী সম্পাদনা' : 'নতুন ব্যবহারকারী'} onClose={onClose} footer={(
      <>
        <button className="mq-btn" onClick={onClose}>বাতিল করুন</button>
        <button className="mq-btn primary" onClick={submit} disabled={busy}>{busy ? 'সংরক্ষণ হচ্ছে…' : 'সংরক্ষণ করুন'}</button>
      </>
    )}>
      <div className="mq-form-grid">
        <Field label="নাম" required><input className="mq-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label="ইউজারনাম" required><input className="mq-input" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} disabled={!!initial} /></Field>
        <Field label="মোবাইল"><input className="mq-input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="ভূমিকা" required>
          <select className="mq-select" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>
            {ROLES.map((r) => <option key={r.id} value={r.id}>{r.bn}</option>)}
          </select>
        </Field>
        <Field label={initial ? 'নতুন পাসওয়ার্ড (পরিবর্তন চাইলে)' : 'পাসওয়ার্ড'} required={!initial}>
          <input className="mq-input" type="password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" />
        </Field>
        {initial && <Field label="অবস্থা"><select className="mq-select" value={f.active ? '1' : '0'} onChange={(e) => setF({ ...f, active: e.target.value === '1' })}><option value="1">সক্রিয়</option><option value="0">নিষ্ক্রিয়</option></select></Field>}
      </div>
      {error && <div className="mq-alert error mq-mt">{error}</div>}
    </Modal>
  );
}

function RoleMatrix(): React.ReactElement {
  const { fail, notify } = useApp();
  const [matrix, setMatrix] = useState<Record<string, string[]>>({});
  const [role, setRole] = useState<Role>('cashier');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await call<Record<string, string[]>>('role.permissions');
        setMatrix(r);
      } catch (e) { fail(e); }
      finally { setLoading(false); }
    })();
  }, [fail]);

  const toggle = (perm: string): void => {
    if (role === 'owner') return;
    setMatrix((m) => {
      const cur = new Set(m[role] || []);
      if (cur.has(perm)) cur.delete(perm);
      else cur.add(perm);
      return { ...m, [role]: [...cur] };
    });
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await call('role.setPermissions', { role, permissions: matrix[role] || [] });
      notify('success', 'অনুমতি হালনাগাদ করা হয়েছে।');
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  };

  if (loading) return <Spinner />;

  return (
    <div>
      <PageHeader title="ভূমিকা ও অনুমতি" sub="প্রতিটি ভূমিকা কী কী করতে পারবে">
        <button className="mq-btn primary" onClick={save} disabled={busy || role === 'owner'}>সংরক্ষণ করুন</button>
      </PageHeader>
      <div className="mq-settings">
        <div className="mq-settings-nav">
          {ROLES.map((r) => <button key={r.id} className={role === r.id ? 'active' : ''} onClick={() => setRole(r.id)}><ShieldCheck /> {r.bn}</button>)}
        </div>
        <div className="mq-card mq-card-pad">
          {role === 'owner'
            ? <div className="mq-alert info">মালিকের সব অনুমতি থাকে — পরিবর্তন করা যাবে না।</div>
            : (
              <div className="mq-grid cols-2">
                {(PERMISSIONS as readonly string[]).map((p) => (
                  <label key={p} className="mq-check">
                    <input type="checkbox" checked={(matrix[role] || []).includes(p)} onChange={() => toggle(p)} />
                    {PERMISSION_BN[p as PermissionKey]}
                  </label>
                ))}
              </div>
            )}
        </div>
      </div>
    </div>
  );
}

function AuditList(): React.ReactElement {
  const { fail } = useApp();
  const { range, RangePicker } = useDateRange('last7');
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<Record<string, unknown>>>({ rows: [], total: 0, page: 1, pageSize: 50 });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call<Paged<Record<string, unknown>>>('audit.list', { opts: { q: debouncedQ, from: range.fromUtc, to: range.toUtc, page, pageSize: 50 } });
      setData(r);
    } catch (e) { fail(e); }
    finally { setLoading(false); }
  }, [debouncedQ, range.fromUtc, range.toUtc, page, fail]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <PageHeader title="অডিট লগ" sub={`${range.from} → ${range.to}`}>
        <RangePicker />
      </PageHeader>
      <div className="mq-toolbar">
        <div className="grow mq-search-wrap"><Search /><input className="mq-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="কাজ বা ব্যবহারকারী খুঁজুন" /></div>
      </div>
      {loading ? <Spinner /> : data.rows.length === 0 ? (
        <div className="mq-card"><EmptyState icon={<ScrollText />} title="কোনো অডিট রেকর্ড নেই" /></div>
      ) : (
        <div className="mq-table-wrap">
          <table className="mq-table">
            <thead><tr><th>সময়</th><th>ব্যবহারকারী</th><th>কাজ</th><th>ধরন</th><th>আইডি</th><th>কারণ</th></tr></thead>
            <tbody>
              {data.rows.map((a) => (
                <tr key={String(a.id)}>
                  <td>{new Date(String(a.occurred_at)).toLocaleString('bn-BD')}</td>
                  <td>{String(a.user_name || '—')}</td>
                  <td><code className="mq-small">{String(a.action)}</code></td>
                  <td>{String(a.entity)}</td>
                  <td>{String(a.entity_id ?? '—')}</td>
                  <td>{String(a.reason || '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
    </div>
  );
}

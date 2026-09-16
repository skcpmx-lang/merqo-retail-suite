import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Wallet, Plus, ArrowLeftRight, Receipt, Eye, Pencil, Trash2, Search, Banknote, Landmark, Smartphone, CreditCard } from 'lucide-react';
import { Layout } from '../components/Layout';
import { PageHeader, Modal, EmptyState, Pagination, Field, Spinner, useDebouncedValue, Confirm } from '../components/ui';
import { useDateRange } from '../components/DateRange';
import { call } from '../api';
import { useApp, useMoney } from '../store';
import type { FinancialAccount, Paged } from '@shared/types';

export function Accounts(): React.ReactElement {
  const [tab, setTab] = useState<'accounts' | 'transfers' | 'expenses'>('accounts');
  const [params] = useSearchParams();
  useEffect(() => {
    if (params.get('tab') === 'expenses') setTab('expenses');
  }, [params]);

  return (
    <Layout title="হিসাব" sub="অ্যাকাউন্ট, স্থানান্তর ও খরচ">
      <div className="mq-tabs">
        <button className={tab === 'accounts' ? 'active' : ''} onClick={() => setTab('accounts')}><Wallet /> অ্যাকাউন্ট</button>
        <button className={tab === 'transfers' ? 'active' : ''} onClick={() => setTab('transfers')}><ArrowLeftRight /> স্থানান্তর</button>
        <button className={tab === 'expenses' ? 'active' : ''} onClick={() => setTab('expenses')}><Receipt /> খরচ</button>
      </div>
      {tab === 'accounts' && <AccountList />}
      {tab === 'transfers' && <TransferList />}
      {tab === 'expenses' && <ExpenseList autoNew={params.get('new') === '1'} />}
    </Layout>
  );
}

const ACC_META: Record<string, { icon: React.ReactNode; color: string; soft: string }> = {
  CASH: { icon: <Banknote />, color: '#12805c', soft: '#e5f5ec' },
  BANK: { icon: <Landmark />, color: '#0e63b6', soft: '#e7f1fb' },
  BKASH: { icon: <Smartphone />, color: '#d1206f', soft: '#fdeef5' },
  NAGAD: { icon: <Smartphone />, color: '#e05f00', soft: '#fef3e8' },
  ROCKET: { icon: <Smartphone />, color: '#6b2fb8', soft: '#f3edfb' },
  UPAY: { icon: <Smartphone />, color: '#0a7d40', soft: '#e9f6ee' },
  CARD: { icon: <CreditCard />, color: '#0e7490', soft: '#e0f4fa' },
  cash: { icon: <Banknote />, color: '#12805c', soft: '#e5f5ec' },
  bank: { icon: <Landmark />, color: '#0e63b6', soft: '#e7f1fb' },
  mfs: { icon: <Smartphone />, color: '#6b2fb8', soft: '#f3edfb' },
  card: { icon: <CreditCard />, color: '#0e7490', soft: '#e0f4fa' },
  other: { icon: <Wallet />, color: '#46566f', soft: '#eef1f7' },
};

function AccountList(): React.ReactElement {
  const { can, fail, notify } = useApp();
  const { fmt } = useMoney();
  const [rows, setRows] = useState<FinancialAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<FinancialAccount | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [transferOpen, setTransferOpen] = useState(false);
  const [stats, setStats] = useState<Record<number, { inn: number; out: number; last: string | null }>>({});

  useEffect(() => {
    if (!rows.length) return;
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const to = now.toISOString();
    (async () => {
      const map: Record<number, { inn: number; out: number; last: string | null }> = {};
      await Promise.all(rows.map(async (acc) => {
        try {
          const r = await call<Paged<Record<string, unknown>>>('account.txns', { id: acc.id, opts: { from, to, page: 1, pageSize: 500 } });
          let inn = 0, out = 0, last: string | null = null;
          for (const t of r.rows) {
            if (t.direction === 'IN') inn += Number(t.amount); else out += Number(t.amount);
            const at = String(t.occurred_at);
            if (!last || at > last) last = at;
          }
          map[acc.id] = { inn, out, last };
        } catch { /* keep card without stats */ }
      }));
      setStats(map);
    })();
  }, [rows]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call<FinancialAccount[]>('account.list');
      setRows(r);
    } catch (e) { fail(e); }
    finally { setLoading(false); }
  }, [fail]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <PageHeader title="আর্থিক হিসাব" sub="নগদ, ব্যাংক, বিকাশ, নগদ, রকেট, উপায় ও অন্যান্য">
        {can('account.transfer') && <button className="mq-btn" onClick={() => setTransferOpen(true)}><ArrowLeftRight /> স্থানান্তর করুন</button>}
        {can('account.manage') && <button className="mq-btn primary" onClick={() => setNewOpen(true)}><Plus /> নতুন হিসাব</button>}
      </PageHeader>
      {loading ? <Spinner /> : (
        <div className="mq-grid cols-3">
          {rows.map((a) => {
            const st = stats[a.id];
            const meta = ACC_META[a.code] || ACC_META[a.type] || ACC_META.other;
            return (
              <div key={a.id} className="mq-card mq-card-pad">
                <div className="mq-between">
                  <div className="mq-flex">
                    <div className="mq-acc-ic" style={{ background: meta.soft, color: meta.color }}>{meta.icon}</div>
                    <div>
                      <p className="mq-card-title" style={{ margin: 0 }}>{a.name}</p>
                      <p className="mq-card-sub" style={{ marginBottom: 0 }}>প্রারম্ভিক: {fmt(a.opening_balance)}</p>
                    </div>
                  </div>
                  <button className="mq-mini-btn" title="লেনদেন দেখুন" onClick={() => setDetail(a)}><Eye /></button>
                </div>
                <div style={{ fontSize: 24, fontWeight: 800, marginTop: 12 }}>{fmt(a.current_balance ?? 0)}</div>
                <div className="mq-small mq-muted">বর্তমান ব্যালেন্স</div>
                <div className="mq-statline">
                  <span className="in">জমা <b>{st ? fmt(st.inn) : '—'}</b></span>
                  <span className="out">ব্যয় <b>{st ? fmt(st.out) : '—'}</b></span>
                  <span>শেষ: {st?.last ? new Date(st.last).toLocaleDateString('bn-BD') : '—'}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {detail && <AccountDetail account={detail} onClose={() => { setDetail(null); load(); }} />}
      {newOpen && <NewAccountModal onClose={() => setNewOpen(false)} onDone={() => { setNewOpen(false); load(); notify('success', 'নতুন হিসাব তৈরি হয়েছে।'); }} />}
      {transferOpen && <TransferModal accounts={rows} onClose={() => setTransferOpen(false)} onDone={() => { setTransferOpen(false); load(); notify('success', 'স্থানান্তর সম্পন্ন হয়েছে।'); }} />}
    </div>
  );
}

function AccountDetail({ account, onClose }: { account: FinancialAccount; onClose: () => void }): React.ReactElement {
  const { fail } = useApp();
  const { fmt } = useMoney();
  const { range, RangePicker } = useDateRange('thisMonth');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<Record<string, unknown>>>({ rows: [], total: 0, page: 1, pageSize: 100 });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call<Paged<Record<string, unknown>>>('account.txns', { id: account.id, opts: { from: range.fromUtc, to: range.toUtc, page, pageSize: 100 } });
      setData(r);
    } catch (e) { fail(e); }
    finally { setLoading(false); }
  }, [account.id, range.fromUtc, range.toUtc, page, fail]);

  useEffect(() => { load(); }, [load]);

  return (
    <Modal title={account.name} sub={`বর্তমান ব্যালেন্স: ${fmt(account.current_balance ?? 0)}`} onClose={onClose} size="lg" footer={(
      <button className="mq-btn" onClick={onClose}>বন্ধ করুন</button>
    )}>
      <RangePicker />
      {loading ? <Spinner /> : (
        <div className="mq-table-wrap mq-mt">
          <table className="mq-table">
            <thead><tr><th>তারিখ</th><th>বিবরণ</th><th className="num">জমা</th><th className="num">খরচ</th></tr></thead>
            <tbody>
              {data.rows.map((t) => (
                <tr key={String(t.id)}>
                  <td>{new Date(String(t.occurred_at)).toLocaleString('bn-BD')}</td>
                  <td>{String(t.description)}</td>
                  <td className="num" style={{ color: 'var(--mq-green)', fontWeight: 700 }}>{t.direction === 'IN' ? fmt(Number(t.amount)) : '—'}</td>
                  <td className="num" style={{ color: 'var(--mq-red)', fontWeight: 700 }}>{t.direction === 'OUT' ? fmt(Number(t.amount)) : '—'}</td>
                </tr>
              ))}
              {data.rows.length === 0 && <tr><td colSpan={4} className="center mq-muted">কোনো লেনদেন নেই</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
    </Modal>
  );
}

function NewAccountModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }): React.ReactElement {
  const { fail } = useApp();
  const [name, setName] = useState('');
  const [type, setType] = useState('other');
  const [opening, setOpening] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await call('account.create', { input: { name: name.trim(), type, opening_balance: opening.trim() ? Math.round((parseFloat(opening) || 0) * 100) : 0 } });
      onDone();
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="নতুন হিসাব" onClose={onClose} footer={(
      <>
        <button className="mq-btn" onClick={onClose}>বাতিল করুন</button>
        <button className="mq-btn primary" onClick={submit} disabled={busy || !name.trim()}>সংরক্ষণ করুন</button>
      </>
    )}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="হিসাবের নাম" required><input className="mq-input" value={name} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="ধরন">
          <select className="mq-select" value={type} onChange={(e) => setType(e.target.value)}>
            <option value="cash">নগদ</option>
            <option value="bank">ব্যাংক</option>
            <option value="mfs">মোবাইল ব্যাংকিং</option>
            <option value="card">কার্ড</option>
            <option value="other">অন্যান্য</option>
          </select>
        </Field>
        <Field label="প্রারম্ভিক ব্যালেন্স (৳)"><input className="mq-input" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

export function TransferModal({ accounts, onClose, onDone }: { accounts: FinancialAccount[]; onClose: () => void; onDone: () => void }): React.ReactElement {
  const { fail } = useApp();
  const { fmt } = useMoney();
  const [from, setFrom] = useState(accounts.find((a) => a.code === 'CASH')?.id ?? accounts[0]?.id ?? 0);
  const [to, setTo] = useState(accounts.find((a) => a.code === 'BANK')?.id ?? accounts[1]?.id ?? 0);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (): Promise<void> => {
    const amt = Math.round((parseFloat(amount) || 0) * 100);
    if (from === to) { setErr('উৎস ও গন্তব্য হিসাব একই হতে পারবে না।'); return; }
    if (amt <= 0) { setErr('সঠিক টাকার পরিমাণ দিন।'); return; }
    setErr('');
    setBusy(true);
    try {
      await call('account.transfer', { input: { from_account_id: from, to_account_id: to, amount: amt, notes: notes.trim() || null } });
      onDone();
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="হিসাব স্থানান্তর" sub="এক হিসাব থেকে অন্য হিসাবে টাকা পাঠান" onClose={onClose} footer={(
      <>
        <button className="mq-btn" onClick={onClose}>বাতিল করুন</button>
        <button className="mq-btn primary" onClick={submit} disabled={busy || from === to}>স্থানান্তর করুন</button>
      </>
    )}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="mq-form-grid">
          <Field label="যেখান থেকে" required>
            <select className="mq-select" value={from} onChange={(e) => { setFrom(Number(e.target.value)); setErr(''); }}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({fmt(a.current_balance ?? 0)})</option>)}
            </select>
          </Field>
          <Field label="যেখানে যাবে" required>
            <select className="mq-select" value={to} onChange={(e) => { setTo(Number(e.target.value)); setErr(''); }}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
        </div>
        <Field label="টাকার পরিমাণ (৳)" required><input className="mq-input" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); setErr(''); }} autoFocus /></Field>
        <Field label="মন্তব্য"><input className="mq-input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        {err && <div className="mq-alert error">{err}</div>}
      </div>
    </Modal>
  );
}

function TransferList(): React.ReactElement {
  const { can, fail, notify } = useApp();
  const { fmt } = useMoney();
  const { range, RangePicker } = useDateRange('thisMonth');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<Record<string, unknown>>>({ rows: [], total: 0, page: 1, pageSize: 50 });
  const [loading, setLoading] = useState(true);
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, a] = await Promise.all([
        call<Paged<Record<string, unknown>>>('account.transfers', { opts: { from: range.fromUtc, to: range.toUtc, page, pageSize: 50 } }),
        call<FinancialAccount[]>('account.list'),
      ]);
      setData(r); setAccounts(a);
    } catch (e) { fail(e); }
    finally { setLoading(false); }
  }, [range.fromUtc, range.toUtc, page, fail]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <PageHeader title="স্থানান্তর ইতিহাস" sub={`${range.from} → ${range.to}`}>
        <RangePicker />
        {can('account.transfer') && <button className="mq-btn primary" onClick={() => setOpen(true)}><Plus /> নতুন স্থানান্তর</button>}
      </PageHeader>
      {loading ? <Spinner /> : data.rows.length === 0 ? (
        <div className="mq-card"><EmptyState icon={<ArrowLeftRight />} title="কোনো স্থানান্তর নেই" /></div>
      ) : (
        <div className="mq-table-wrap">
          <table className="mq-table">
            <thead><tr><th>রেফারেন্স</th><th>তারিখ</th><th>থেকে</th><th>যেখানে</th><th className="num">পরিমাণ</th><th>মন্তব্য</th></tr></thead>
            <tbody>
              {data.rows.map((t) => (
                <tr key={String(t.id)}>
                  <td><strong>{String(t.reference)}</strong></td>
                  <td>{new Date(String(t.occurred_at)).toLocaleString('bn-BD')}</td>
                  <td>{String(t.from_name)}</td>
                  <td>{String(t.to_name)}</td>
                  <td className="num">{fmt(Number(t.amount))}</td>
                  <td>{String(t.notes || '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
      {open && <TransferModal accounts={accounts} onClose={() => setOpen(false)} onDone={() => { setOpen(false); load(); notify('success', 'স্থানান্তর সম্পন্ন হয়েছে।'); }} />}
    </div>
  );
}

function ExpenseList({ autoNew }: { autoNew: boolean }): React.ReactElement {
  const { can, fail, notify } = useApp();
  const { fmt } = useMoney();
  const { range, RangePicker } = useDateRange('thisMonth');
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);
  const [cat, setCat] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<Record<string, unknown>> & { sum?: number }>({ rows: [], total: 0, page: 1, pageSize: 50 });
  const [cats, setCats] = useState<{ id: number; name: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(autoNew);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [deleting, setDeleting] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, c] = await Promise.all([
        call<Paged<Record<string, unknown>> & { sum?: number }>('expense.list', { opts: { q: debouncedQ, category_id: cat ? Number(cat) : undefined, from: range.fromUtc, to: range.toUtc, page, pageSize: 50 } }),
        call<{ id: number; name: string }[]>('master.list', { table: 'expense_categories' }),
      ]);
      setData(r); setCats(c);
    } catch (e) { fail(e); }
    finally { setLoading(false); }
  }, [debouncedQ, cat, range.fromUtc, range.toUtc, page, fail]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [debouncedQ, cat, range.fromUtc, range.toUtc]);

  return (
    <div>
      <PageHeader title="খরচ" sub={`${range.from} → ${range.to} • মোট: ${fmt(data.sum ?? 0)}`}>
        <RangePicker />
        {can('expense.create') && <button className="mq-btn primary" onClick={() => { setEditing(null); setFormOpen(true); }}><Plus /> খরচ যোগ করুন</button>}
      </PageHeader>
      <div className="mq-toolbar">
        <div className="grow mq-search-wrap"><Search /><input className="mq-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="বিবরণ খুঁজুন" /></div>
        <select className="mq-select" style={{ width: 200 }} value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">সব ক্যাটাগরি</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      {loading ? <Spinner /> : data.rows.length === 0 ? (
        <div className="mq-card"><EmptyState icon={<Receipt />} title="কোনো খরচের রেকর্ড নেই" /></div>
      ) : (
        <div className="mq-table-wrap">
          <table className="mq-table">
            <thead><tr><th>তারিখ</th><th>ক্যাটাগরি</th><th>বিবরণ</th><th>হিসাব</th><th className="num">পরিমাণ</th><th className="center">কার্যক্রম</th></tr></thead>
            <tbody>
              {data.rows.map((e) => (
                <tr key={String(e.id)}>
                  <td>{new Date(String(e.occurred_at)).toLocaleString('bn-BD')}</td>
                  <td>{String(e.category_name || '—')}</td>
                  <td>{String(e.description || '—')}</td>
                  <td>{String(e.account_name)}</td>
                  <td className="num">{fmt(Number(e.amount))}</td>
                  <td><div className="mq-row-actions">
                    {can('expense.edit') && <button className="mq-mini-btn" onClick={() => { setEditing(e); setFormOpen(true); }}><Pencil /></button>}
                    {can('expense.edit') && <button className="mq-mini-btn danger" onClick={() => setDeleting(e)}><Trash2 /></button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={4}>মোট</td><td className="num">{fmt(data.sum ?? 0)}</td><td /></tr></tfoot>
          </table>
        </div>
      )}
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
      {formOpen && <ExpenseForm initial={editing} cats={cats} onClose={() => { setFormOpen(false); setEditing(null); }} onSaved={() => { setFormOpen(false); setEditing(null); load(); }} />}
      {deleting && (
        <Confirm title="খরচ মুছুন" message="এই খরচের রেকর্ডটি মুছে ফেলা হবে এবং হিসাব থেকে টাকা ফেরত সমন্বয় হবে।" danger
          onCancel={() => setDeleting(null)} busy={busy} onConfirm={async () => {
            setBusy(true);
            try { await call('expense.delete', { id: Number(deleting.id) }); notify('success', 'খরচ মুছে ফেলা হয়েছে।'); setDeleting(null); load(); } catch (e) { fail(e); }
            finally { setBusy(false); }
          }} />
      )}
    </div>
  );
}

function ExpenseForm({ initial, cats, onClose, onSaved }: {
  initial: Record<string, unknown> | null; cats: { id: number; name: string }[]; onClose: () => void; onSaved: () => void;
}): React.ReactElement {
  const { fail, notify } = useApp();
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [f, setF] = useState({
    category_id: initial?.category_id ? String(initial.category_id) : '',
    amount: initial ? String(Number(initial.amount) / 100) : '',
    account_id: initial?.account_id ? String(initial.account_id) : '',
    description: (initial?.description as string) || '',
    reference: (initial?.reference as string) || '',
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const a = await call<FinancialAccount[]>('account.list');
        setAccounts(a);
        if (!initial) {
          const cash = a.find((x) => x.code === 'CASH');
          if (cash) setF((p) => ({ ...p, account_id: String(cash.id) }));
        }
      } catch (e) { fail(e); }
    })();
  }, [fail, initial]);

  const submit = async (): Promise<void> => {
    const amt = Math.round((parseFloat(f.amount) || 0) * 100);
    if (amt <= 0) { notify('error', 'সঠিক টাকার পরিমাণ দিন।'); return; }
    if (!f.account_id) { notify('error', 'হিসাব নির্বাচন করুন।'); return; }
    setBusy(true);
    try {
      if (initial) {
        await call('expense.update', { id: Number(initial.id), input: { category_id: f.category_id ? Number(f.category_id) : null, amount: amt, account_id: Number(f.account_id), description: f.description.trim() || null, reference: f.reference.trim() || null } });
      } else {
        await call('expense.create', { input: { category_id: f.category_id ? Number(f.category_id) : null, amount: amt, account_id: Number(f.account_id), description: f.description.trim() || null, reference: f.reference.trim() || null } });
      }
      notify('success', 'তথ্য সংরক্ষণ করা হয়েছে।');
      onSaved();
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={initial ? 'খরচ সম্পাদনা' : 'নতুন খরচ'} onClose={onClose} footer={(
      <>
        <button className="mq-btn" onClick={onClose}>বাতিল করুন</button>
        <button className="mq-btn primary" onClick={submit} disabled={busy}>{busy ? 'সংরক্ষণ হচ্ছে…' : 'সংরক্ষণ করুন'}</button>
      </>
    )}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="ক্যাটাগরি">
          <select className="mq-select" value={f.category_id} onChange={(e) => setF({ ...f, category_id: e.target.value })}>
            <option value="">নির্বাচন করুন</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="টাকার পরিমাণ (৳)" required><input className="mq-input" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} autoFocus /></Field>
        <Field label="হিসাব" required>
          <select className="mq-select" value={f.account_id} onChange={(e) => setF({ ...f, account_id: e.target.value })}>
            <option value="">নির্বাচন করুন</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="বিবরণ"><input className="mq-input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="যেমন: দোকান ভাড়া — জানুয়ারি" /></Field>
        <Field label="রেফারেন্স"><input className="mq-input" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

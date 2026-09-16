import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Users, Plus, Search, Eye, Pencil, HandCoins, FileText, Printer } from 'lucide-react';
import { Layout } from '../components/Layout';
import { PageHeader, Modal, EmptyState, Badge, Pagination, Field, Spinner, useDebouncedValue } from '../components/ui';
import { useDateRange } from '../components/DateRange';
import { call, api } from '../api';
import { useApp, useMoney } from '../store';
import { PAYMENT_METHOD_BN, PaymentMethod } from '@shared/constants';
import type { Customer, FinancialAccount, LedgerEntry, Paged } from '@shared/types';
import { paymentReceiptHtml, reportPrintHtml } from '../components/PrintDocs';

export function Customers(): React.ReactElement {
  const { business, can, fail, notify } = useApp();
  const { fmt } = useMoney();
  const [params] = useSearchParams();
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);
  const [dueOnly, setDueOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<Customer>>({ rows: [], total: 0, page: 1, pageSize: 50 });
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [profile, setProfile] = useState<(Customer & { current_due: number; total_purchases: number; total_payments: number }) | null>(null);
  const [payTarget, setPayTarget] = useState<Customer | null>(params.get('pay') === '1' ? ({} as Customer) : null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call<Paged<Customer>>('customer.list', { opts: { q: debouncedQ, has_due: dueOnly || undefined, sort: 'due', page, pageSize: 50 } });
      setData(r);
    } catch (e) { fail(e); }
    finally { setLoading(false); }
  }, [debouncedQ, dueOnly, page, fail]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [debouncedQ, dueOnly]);

  useEffect(() => {
    const id = params.get('id');
    if (id) {
      (async () => {
        try {
          const p = await call<Customer & { current_due: number; total_purchases: number; total_payments: number }>('customer.profile', { id: Number(id) });
          setProfile(p);
        } catch (e) { fail(e); }
      })();
    }
  }, [params, fail]);

  const openProfile = async (id: number): Promise<void> => {
    try {
      const p = await call<Customer & { current_due: number; total_purchases: number; total_payments: number }>('customer.profile', { id });
      setProfile(p);
    } catch (e) { fail(e); }
  };

  return (
    <Layout title="কাস্টমার" sub="কাস্টমার, বকেয়া ও পেমেন্ট">
      <PageHeader title="কাস্টমার" sub={`মোট ${data.total} জন`}>
        <div className="mq-segment">
          <button className={!dueOnly ? 'active' : ''} onClick={() => setDueOnly(false)}>সবাই</button>
          <button className={dueOnly ? 'active' : ''} onClick={() => setDueOnly(true)}>বকেয়া আছে</button>
        </div>
        {can('customer.payment') && <button className="mq-btn" onClick={() => setPayTarget({} as Customer)}><HandCoins /> পেমেন্ট গ্রহণ</button>}
        {can('customer.create') && <button className="mq-btn primary" onClick={() => { setEditing(null); setFormOpen(true); }}><Plus /> নতুন কাস্টমার</button>}
      </PageHeader>
      <div className="mq-toolbar">
        <div className="grow mq-search-wrap"><Search /><input className="mq-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="নাম বা মোবাইল খুঁজুন" /></div>
      </div>
      {loading ? <Spinner /> : data.rows.length === 0 ? (
        <div className="mq-card"><EmptyState icon={<Users />} title="এখনও কোনো কাস্টমার যোগ করা হয়নি" sub="নতুন কাস্টমার যোগ করে শুরু করুন।"
          action={can('customer.create') ? <button className="mq-btn primary" onClick={() => { setEditing(null); setFormOpen(true); }}><Plus /> নতুন কাস্টমার যোগ করুন</button> : undefined} /></div>
      ) : (
        <div className="mq-table-wrap">
          <table className="mq-table">
            <thead><tr><th>নাম</th><th>মোবাইল</th><th>ঠিকানা</th><th className="num">বকেয়া</th><th className="center">কার্যক্রম</th></tr></thead>
            <tbody>
              {data.rows.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.name}</strong></td>
                  <td>{c.phone || '—'}</td>
                  <td>{c.address || '—'}</td>
                  <td className="num">{(c.current_due ?? 0) > 0 ? <Badge tone="amber">{fmt(c.current_due ?? 0)}</Badge> : <span className="mq-muted">০</span>}</td>
                  <td><div className="mq-row-actions">
                    <button className="mq-mini-btn" title="প্রোফাইল" onClick={() => openProfile(c.id)}><Eye /></button>
                    {can('customer.edit') && <button className="mq-mini-btn" title="সম্পাদনা" onClick={() => { setEditing(c); setFormOpen(true); }}><Pencil /></button>}
                    {can('customer.payment') && <button className="mq-mini-btn" title="পেমেন্ট গ্রহণ" onClick={() => setPayTarget(c)}><HandCoins /></button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />

      {formOpen && <CustomerForm initial={editing} onClose={() => { setFormOpen(false); setEditing(null); }} onSaved={() => { setFormOpen(false); setEditing(null); load(); }} />}
      {profile && <CustomerProfile key={profile.id} customer={profile} onClose={() => setProfile(null)} onPay={() => { setPayTarget(profile); }} onChanged={() => { openProfile(profile.id); load(); }} />}
      {payTarget && <CustomerPayModal preset={payTarget.id ? payTarget : null} customers={data.rows} onClose={() => setPayTarget(null)} onDone={() => { setPayTarget(null); load(); setProfile(null); }} />}
    </Layout>
  );
}

function CustomerForm({ initial, onClose, onSaved }: { initial: Customer | null; onClose: () => void; onSaved: () => void }): React.ReactElement {
  const { fail, notify } = useApp();
  const [f, setF] = useState({
    name: initial?.name || '', phone: initial?.phone || '', address: initial?.address || '',
    email: initial?.email || '', opening_due: initial ? String(initial.opening_due / 100) : '', notes: initial?.notes || '',
    status: initial?.status || 'active',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (): Promise<void> => {
    if (!f.name.trim()) { setError('কাস্টমারের নাম আবশ্যক।'); return; }
    setBusy(true);
    try {
      if (initial) {
        await call('customer.update', { id: initial.id, input: { name: f.name.trim(), phone: f.phone.trim() || null, address: f.address.trim() || null, email: f.email.trim() || null, notes: f.notes.trim() || null, status: f.status } });
        notify('success', 'তথ্য সংরক্ষণ করা হয়েছে।');
      } else {
        await call('customer.create', {
          input: {
            name: f.name.trim(), phone: f.phone.trim() || null, address: f.address.trim() || null,
            email: f.email.trim() || null, opening_due: f.opening_due.trim() ? Math.round((parseFloat(f.opening_due) || 0) * 100) : 0,
            notes: f.notes.trim() || null,
          },
        });
        notify('success', 'নতুন কাস্টমার যোগ করা হয়েছে।');
      }
      onSaved();
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={initial ? 'কাস্টমার সম্পাদনা' : 'নতুন কাস্টমার'} onClose={onClose} footer={(
      <>
        <button className="mq-btn" onClick={onClose}>বাতিল করুন</button>
        <button className="mq-btn primary" onClick={submit} disabled={busy}>{busy ? 'সংরক্ষণ হচ্ছে…' : 'সংরক্ষণ করুন'}</button>
      </>
    )}>
      <div className="mq-form-grid">
        <Field label="নাম" required><input className="mq-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label="মোবাইল"><input className="mq-input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="01XXXXXXXXX" /></Field>
        <Field label="ঠিকানা"><input className="mq-input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <Field label="ইমেইল"><input className="mq-input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        {!initial && <Field label="প্রারম্ভিক বকেয়া (৳)"><input className="mq-input" inputMode="decimal" value={f.opening_due} onChange={(e) => setF({ ...f, opening_due: e.target.value })} placeholder="০" /></Field>}
        {initial && <Field label="অবস্থা"><select className="mq-select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as 'active' | 'inactive' })}><option value="active">সক্রিয়</option><option value="inactive">নিষ্ক্রিয়</option></select></Field>}
        <Field label="মন্তব্য"><input className="mq-input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      {error && <div className="mq-alert error mq-mt">{error}</div>}
    </Modal>
  );
}

function CustomerProfile({ customer, onClose, onPay, onChanged }: {
  customer: Customer & { current_due: number; total_purchases: number; total_payments: number };
  onClose: () => void; onPay: () => void; onChanged: () => void;
}): React.ReactElement {
  const { business, can, fail, notify } = useApp();
  const { fmt } = useMoney();
  const { range, RangePicker } = useDateRange('last3months');
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call<Paged<LedgerEntry>>('customer.ledger', { id: customer.id, opts: { from: range.fromUtc, to: range.toUtc, page: 1, pageSize: 500 } });
      setLedger(r.rows);
    } catch (e) { fail(e); }
    finally { setLoading(false); }
  }, [customer.id, range.fromUtc, range.toUtc, fail]);

  useEffect(() => { load(); }, [load]);

  const printStatement = async (mode: 'print' | 'pdf' | 'preview'): Promise<void> => {
    if (!business) return;
    const html = reportPrintHtml(business, `কাস্টমার স্টেটমেন্ট — ${customer.name}`,
      `সময়: ${range.from} → ${range.to} • বর্তমান বকেয়া: ${fmt(customer.current_due)}`,
      ['তারিখ', 'বিবরণ', 'ডেবিট', 'ক্রেডিট', 'ব্যালেন্স'],
      ledger.map((l) => [
        new Date(l.occurred_at).toLocaleDateString('bn-BD'),
        l.description,
        l.debit ? fmt(l.debit) : '—',
        l.credit ? fmt(l.credit) : '—',
        fmt(l.balance),
      ]));
    if (mode === 'preview') await api.preview({ html, title: 'স্টেটমেন্ট' });
    else if (mode === 'pdf') {
      const r = await api.pdf({ html, pageSize: 'A4' });
      notify(r.ok ? 'success' : 'error', r.ok ? 'PDF সংরক্ষণ করা হয়েছে।' : 'PDF তৈরি করা যায়নি।');
    } else {
      const r = await api.print({ html, silent: false });
      if (!r.ok) notify('error', 'প্রিন্ট করা যায়নি।');
    }
  };

  return (
    <Modal title={customer.name} sub={`${customer.phone || ''} ${customer.address ? '• ' + customer.address : ''}`} onClose={onClose} size="lg" footer={(
      <>
        <button className="mq-btn" onClick={() => printStatement('preview')}><Eye /> প্রিভিউ</button>
        <button className="mq-btn" onClick={() => printStatement('pdf')}><FileText /> PDF</button>
        <button className="mq-btn" onClick={() => printStatement('print')}><Printer /> প্রিন্ট</button>
        {can('customer.payment') && <button className="mq-btn primary" onClick={onPay}><HandCoins /> পেমেন্ট গ্রহণ</button>}
      </>
    )}>
      <div className="mq-grid cols-3" style={{ marginBottom: 12 }}>
        <div className="mq-kpi" style={{ ['--mq-kpi-color' as string]: '#0e63b6' }}><div className="mq-kpi-label">মোট ক্রয়</div><div className="mq-kpi-value" style={{ fontSize: 18 }}>{fmt(customer.total_purchases)}</div></div>
        <div className="mq-kpi" style={{ ['--mq-kpi-color' as string]: '#12805c' }}><div className="mq-kpi-label">মোট পেমেন্ট</div><div className="mq-kpi-value" style={{ fontSize: 18 }}>{fmt(customer.total_payments)}</div></div>
        <div className="mq-kpi" style={{ ['--mq-kpi-color' as string]: '#9a6200' }}><div className="mq-kpi-label">বর্তমান বকেয়া</div><div className="mq-kpi-value" style={{ fontSize: 18 }}>{fmt(customer.current_due)}</div></div>
      </div>
      <RangePicker />
      {loading ? <Spinner /> : (
        <div className="mq-table-wrap mq-mt">
          <table className="mq-table">
            <thead><tr><th>তারিখ</th><th>বিবরণ</th><th className="num">ডেবিট</th><th className="num">ক্রেডিট</th><th className="num">ব্যালেন্স</th></tr></thead>
            <tbody>
              {ledger.map((l) => (
                <tr key={l.id}>
                  <td>{new Date(l.occurred_at).toLocaleString('bn-BD')}</td>
                  <td>{l.description}</td>
                  <td className="num">{l.debit ? fmt(l.debit) : '—'}</td>
                  <td className="num">{l.credit ? fmt(l.credit) : '—'}</td>
                  <td className="num"><strong>{fmt(l.balance)}</strong></td>
                </tr>
              ))}
              {ledger.length === 0 && <tr><td colSpan={5} className="center mq-muted">কোনো লেনদেন নেই</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

export function CustomerPayModal({ preset, customers, onClose, onDone }: {
  preset: Customer | null; customers: Customer[]; onClose: () => void; onDone: (ref?: Record<string, unknown>, remaining?: number) => void;
}): React.ReactElement {
  const { business, fail, notify } = useApp();
  const { fmt } = useMoney();
  const [cid, setCid] = useState(preset?.id ? String(preset.id) : '');
  const [due, setDue] = useState<number | null>(preset?.current_due ?? null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('cash');
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [accountId, setAccountId] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const a = await call<FinancialAccount[]>('account.list');
        setAccounts(a);
        const cash = a.find((x) => x.code === 'CASH');
        if (cash) setAccountId(String(cash.id));
      } catch (e) { fail(e); }
    })();
  }, [fail]);

  useEffect(() => {
    if (!cid) { setDue(null); return; }
    (async () => {
      try {
        const p = await call<Customer & { current_due: number }>('customer.profile', { id: Number(cid) });
        setDue(p.current_due);
      } catch { /* noop */ }
    })();
  }, [cid]);

  const submit = async (withReceipt: boolean): Promise<void> => {
    if (!cid) { notify('error', 'কাস্টমার নির্বাচন করুন।'); return; }
    const amt = Math.round((parseFloat(amount) || 0) * 100);
    if (amt <= 0) { notify('error', 'সঠিক টাকার পরিমাণ দিন।'); return; }
    if (!accountId) { notify('error', 'হিসাব নির্বাচন করুন।'); return; }
    setBusy(true);
    try {
      const r = await call<{ id: number; reference: string; remaining_due: number }>('customer.pay', {
        input: { customer_id: Number(cid), account_id: Number(accountId), method, amount: amt, notes: notes.trim() || null },
      });
      notify('success', `পেমেন্ট গ্রহণ করা হয়েছে। অবশিষ্ট বকেয়া: ${fmt(r.remaining_due)}`);
      if (withReceipt && business) {
        const c = customers.find((x) => x.id === Number(cid));
        const html = paymentReceiptHtml(business, 'customer',
          { reference: r.reference, paid_at: new Date().toISOString(), method, amount: amt, account_name: accounts.find((a) => a.id === Number(accountId))?.name },
          c?.name || '', due ?? 0, r.remaining_due);
        await api.preview({ html, title: `রসিদ ${r.reference}` });
      }
      onDone();
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="কাস্টমার পেমেন্ট গ্রহণ" onClose={onClose} footer={(
      <>
        <button className="mq-btn" onClick={onClose}>বাতিল করুন</button>
        <button className="mq-btn" onClick={() => submit(true)} disabled={busy}><Printer /> সংরক্ষণ + রসিদ</button>
        <button className="mq-btn primary" onClick={() => submit(false)} disabled={busy}>{busy ? 'প্রক্রিয়াকরণ…' : 'সংরক্ষণ করুন'}</button>
      </>
    )}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="কাস্টমার" required>
          <select className="mq-select" value={cid} onChange={(e) => setCid(e.target.value)}>
            <option value="">নির্বাচন করুন</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name} — বকেয়া {fmt(c.current_due ?? 0)}</option>)}
          </select>
        </Field>
        {due !== null && <div className="mq-alert info">বর্তমান বকেয়া: <strong>{fmt(due)}</strong></div>}
        <Field label="টাকার পরিমাণ (৳)" required>
          <input className="mq-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="০" autoFocus />
        </Field>
        <div className="mq-paygrid">
          {(Object.keys(PAYMENT_METHOD_BN) as PaymentMethod[]).map((m) => (
            <button key={m} className={`mq-paybtn${method === m ? ' active' : ''}`} onClick={() => {
              setMethod(m);
              const map: Record<string, string> = { cash: 'CASH', bank: 'BANK', bkash: 'BKASH', nagad: 'NAGAD', rocket: 'ROCKET', upay: 'UPAY', card: 'CARD', other: 'OTHER' };
              const a = accounts.find((x) => x.code === map[m]);
              if (a) setAccountId(String(a.id));
            }}>{PAYMENT_METHOD_BN[m]}</button>
          ))}
        </div>
        <Field label="হিসাব" required>
          <select className="mq-select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="মন্তব্য"><input className="mq-input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

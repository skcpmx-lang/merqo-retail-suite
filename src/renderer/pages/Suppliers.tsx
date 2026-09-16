import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Truck, Plus, Search, Eye, Pencil, Handshake, FileText, Printer } from 'lucide-react';
import { Layout } from '../components/Layout';
import { PageHeader, Modal, EmptyState, Badge, Pagination, Field, Spinner, useDebouncedValue, PayMethodGrid, FormSection, TableSkeleton } from '../components/ui';
import { useDateRange } from '../components/DateRange';
import { call, api } from '../api';
import { useApp, useMoney } from '../store';
import { PAYMENT_METHOD_BN, PaymentMethod } from '@shared/constants';
import { isValidPhoneBD, isValidEmail } from '@shared/validators';
import type { FinancialAccount, LedgerEntry, Paged, Supplier } from '@shared/types';
import { paymentReceiptHtml, reportPrintHtml } from '../components/PrintDocs';

export function Suppliers(): React.ReactElement {
  const { can, fail, notify } = useApp();
  const { fmt } = useMoney();
  const [params] = useSearchParams();
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);
  const [payableOnly, setPayableOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<Supplier>>({ rows: [], total: 0, page: 1, pageSize: 50 });
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [profile, setProfile] = useState<(Supplier & { current_payable: number; total_purchases: number; total_payments: number }) | null>(null);
  const [payTarget, setPayTarget] = useState<Supplier | null>(params.get('pay') === '1' ? ({} as Supplier) : null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call<Paged<Supplier>>('supplier.list', { opts: { q: debouncedQ, has_payable: payableOnly || undefined, sort: 'payable', page, pageSize: 50 } });
      setData(r);
    } catch (e) { fail(e); }
    finally { setLoading(false); }
  }, [debouncedQ, payableOnly, page, fail]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [debouncedQ, payableOnly]);

  useEffect(() => {
    const id = params.get('id');
    if (id) {
      (async () => {
        try {
          const p = await call<Supplier & { current_payable: number; total_purchases: number; total_payments: number }>('supplier.profile', { id: Number(id) });
          setProfile(p);
        } catch (e) { fail(e); }
      })();
    }
  }, [params, fail]);

  const openProfile = async (id: number): Promise<void> => {
    try {
      const p = await call<Supplier & { current_payable: number; total_purchases: number; total_payments: number }>('supplier.profile', { id });
      setProfile(p);
    } catch (e) { fail(e); }
  };

  return (
    <Layout title="সরবরাহকারী" sub="সরবরাহকারী, দেনা ও পেমেন্ট">
      <PageHeader title="সরবরাহকারী" sub={`মোট ${data.total} জন`}>
        <div className="mq-segment">
          <button className={!payableOnly ? 'active' : ''} onClick={() => setPayableOnly(false)}>সবাই</button>
          <button className={payableOnly ? 'active' : ''} onClick={() => setPayableOnly(true)}>দেনা আছে</button>
        </div>
        {can('supplier.payment') && <button className="mq-btn" onClick={() => setPayTarget({} as Supplier)}><Handshake /> পেমেন্ট দিন</button>}
        {can('supplier.create') && <button className="mq-btn primary" onClick={() => { setEditing(null); setFormOpen(true); }}><Plus /> নতুন সরবরাহকারী</button>}
      </PageHeader>
      <div className="mq-toolbar">
        <div className="grow mq-search-wrap"><Search /><input className="mq-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="নাম বা মোবাইল খুঁজুন" /></div>
      </div>
      {loading ? <Spinner /> : data.rows.length === 0 ? (
        <div className="mq-card"><EmptyState icon={<Truck />} title="এখনও কোনো সরবরাহকারী যোগ করা হয়নি"
          action={can('supplier.create') ? <button className="mq-btn primary" onClick={() => { setEditing(null); setFormOpen(true); }}><Plus /> নতুন সরবরাহকারী যোগ করুন</button> : undefined} /></div>
      ) : (
        <div className="mq-table-wrap">
          <table className="mq-table">
            <thead><tr><th>নাম</th><th>মোবাইল</th><th className="num">মোট ক্রয়</th><th className="num">মোট পেমেন্ট</th><th className="num">দেনা</th><th>শেষ লেনদেন</th><th>অবস্থা</th><th className="center">কার্যক্রম</th></tr></thead>
            <tbody>
              {data.rows.map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.name}</strong></td>
                  <td className="mq-mono">{s.phone || '—'}</td>
                  <td className="num">{fmt(s.total_purchases ?? 0)}</td>
                  <td className="num">{fmt(s.total_payments ?? 0)}</td>
                  <td className="num">{(s.current_payable ?? 0) > 0 ? <Badge tone="red">{fmt(s.current_payable ?? 0)}</Badge> : <span className="mq-muted">০</span>}</td>
                  <td className="mq-small">{s.last_activity_at ? new Date(s.last_activity_at).toLocaleDateString('bn-BD') : '—'}</td>
                  <td>{s.status === 'active' ? <Badge tone="green">সক্রিয়</Badge> : <Badge tone="gray">নিষ্ক্রিয়</Badge>}</td>
                  <td><div className="mq-row-actions">
                    <button className="mq-mini-btn" title="প্রোফাইল" onClick={() => openProfile(s.id)}><Eye /></button>
                    {can('supplier.edit') && <button className="mq-mini-btn" title="সম্পাদনা" onClick={() => { setEditing(s); setFormOpen(true); }}><Pencil /></button>}
                    {can('supplier.payment') && <button className="mq-mini-btn" title="পেমেন্ট দিন" onClick={() => setPayTarget(s)}><Handshake /></button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />

      {formOpen && <SupplierForm initial={editing} onClose={() => { setFormOpen(false); setEditing(null); }} onSaved={() => { setFormOpen(false); setEditing(null); load(); }} />}
      {profile && <SupplierProfile key={profile.id} supplier={profile} onClose={() => setProfile(null)} onPay={() => setPayTarget(profile)} />}
      {payTarget && <SupplierPayModal preset={payTarget.id ? payTarget : null} suppliers={data.rows} onClose={() => setPayTarget(null)} onDone={() => { setPayTarget(null); load(); setProfile(null); }} />}
    </Layout>
  );
}

function SupplierForm({ initial, onClose, onSaved }: { initial: Supplier | null; onClose: () => void; onSaved: () => void }): React.ReactElement {
  const { fail, notify } = useApp();
  const [f, setF] = useState({
    name: initial?.name || '', phone: initial?.phone || '', address: initial?.address || '',
    email: initial?.email || '', opening_payable: initial ? String(initial.opening_payable / 100) : '', notes: initial?.notes || '',
    status: initial?.status || 'active',
  });
  const [busy, setBusy] = useState(false);
  const [errs, setErrs] = useState<{ name?: string; phone?: string; email?: string }>({});

  const submit = async (): Promise<void> => {
    const next: { name?: string; phone?: string; email?: string } = {};
    if (!f.name.trim()) next.name = 'সরবরাহকারীর নাম আবশ্যক।';
    if (f.phone.trim() && !isValidPhoneBD(f.phone.trim())) next.phone = 'মোবাইল নম্বরটি সঠিক নয়। উদাহরণ: 017XXXXXXXX অথবা +88017XXXXXXXX।';
    if (f.email.trim() && !isValidEmail(f.email.trim())) next.email = 'ইমেইল ঠিকানাটি সঠিক নয়। যাচাই করে আবার চেষ্টা করুন।';
    setErrs(next);
    if (Object.keys(next).length) return;
    setBusy(true);
    try {
      if (initial) {
        await call('supplier.update', { id: initial.id, input: { name: f.name.trim(), phone: f.phone.trim() || null, address: f.address.trim() || null, email: f.email.trim() || null, notes: f.notes.trim() || null, status: f.status } });
        notify('success', 'সরবরাহকারীর তথ্য সংরক্ষণ করা হয়েছে।');
      } else {
        await call('supplier.create', {
          input: {
            name: f.name.trim(), phone: f.phone.trim() || null, address: f.address.trim() || null,
            email: f.email.trim() || null, opening_payable: f.opening_payable.trim() ? Math.round((parseFloat(f.opening_payable) || 0) * 100) : 0,
            notes: f.notes.trim() || null,
          },
        });
        notify('success', 'সরবরাহকারী সফলভাবে যোগ হয়েছে।');
      }
      onSaved();
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={initial ? 'সরবরাহকারী সম্পাদনা' : 'নতুন সরবরাহকারী'} onClose={onClose} footer={(
      <>
        <button className="mq-btn" onClick={onClose}>বাতিল করুন</button>
        <button className="mq-btn primary" onClick={submit} disabled={busy}>{busy ? 'সংরক্ষণ হচ্ছে…' : 'সংরক্ষণ করুন'}</button>
      </>
    )}>
      <FormSection title="মৌলিক তথ্য">
        <Field label="নাম" required error={errs.name}><input className={`mq-input${errs.name ? ' error' : ''}`} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <Field label="মোবাইল" error={errs.phone}><input className={`mq-input${errs.phone ? ' error' : ''}`} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="01XXXXXXXXX" /></Field>
      </FormSection>
      <FormSection title="যোগাযোগ ও ঠিকানা">
        <Field label="ঠিকানা"><input className="mq-input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <Field label="ইমেইল" error={errs.email}><input className={`mq-input${errs.email ? ' error' : ''}`} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="name@example.com" /></Field>
      </FormSection>
      <FormSection title="আর্থিক ও অন্যান্য">
        {!initial && <Field label="প্রারম্ভিক দেনা (৳)"><input className="mq-input" inputMode="decimal" value={f.opening_payable} onChange={(e) => setF({ ...f, opening_payable: e.target.value })} placeholder="০" /></Field>}
        {initial && <Field label="অবস্থা"><select className="mq-select" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as 'active' | 'inactive' })}><option value="active">সক্রিয়</option><option value="inactive">নিষ্ক্রিয়</option></select></Field>}
        <Field label="মন্তব্য"><input className="mq-input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </FormSection>
    </Modal>
  );
}

function SupplierProfile({ supplier, onClose, onPay }: {
  supplier: Supplier & { current_payable: number; total_purchases: number; total_payments: number };
  onClose: () => void; onPay: () => void;
}): React.ReactElement {
  const { business, can, fail, notify } = useApp();
  const { fmt } = useMoney();
  const { range, RangePicker } = useDateRange('last3months');
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call<Paged<LedgerEntry>>('supplier.ledger', { id: supplier.id, opts: { from: range.fromUtc, to: range.toUtc, page: 1, pageSize: 500 } });
      setLedger(r.rows);
    } catch (e) { fail(e); }
    finally { setLoading(false); }
  }, [supplier.id, range.fromUtc, range.toUtc, fail]);

  useEffect(() => { load(); }, [load]);

  const printStatement = async (mode: 'print' | 'pdf' | 'preview'): Promise<void> => {
    if (!business) return;
    const html = reportPrintHtml(business, `সরবরাহকারী স্টেটমেন্ট — ${supplier.name}`,
      `সময়: ${range.from} → ${range.to} • বর্তমান দেনা: ${fmt(supplier.current_payable)}`,
      ['তারিখ', 'বিবরণ', 'ডেবিট', 'ক্রেডিট', 'ব্যালেন্স'],
      ledger.map((l) => [
        new Date(l.occurred_at).toLocaleDateString('bn-BD'), l.description,
        l.debit ? fmt(l.debit) : '—', l.credit ? fmt(l.credit) : '—', fmt(l.balance),
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
    <Modal title={supplier.name} sub={`${supplier.phone || ''} ${supplier.address ? '• ' + supplier.address : ''}`} onClose={onClose} size="lg" footer={(
      <>
        <button className="mq-btn" onClick={() => printStatement('preview')}><Eye /> প্রিভিউ</button>
        <button className="mq-btn" onClick={() => printStatement('pdf')}><FileText /> PDF</button>
        <button className="mq-btn" onClick={() => printStatement('print')}><Printer /> প্রিন্ট</button>
        {can('supplier.payment') && <button className="mq-btn primary" onClick={onPay}><Handshake /> পেমেন্ট দিন</button>}
      </>
    )}>
      <div className="mq-grid cols-3" style={{ marginBottom: 12 }}>
        <div className="mq-kpi" style={{ ['--mq-kpi-color' as string]: '#0e63b6' }}><div className="mq-kpi-label">মোট ক্রয়</div><div className="mq-kpi-value" style={{ fontSize: 18 }}>{fmt(supplier.total_purchases)}</div></div>
        <div className="mq-kpi" style={{ ['--mq-kpi-color' as string]: '#12805c' }}><div className="mq-kpi-label">মোট পেমেন্ট</div><div className="mq-kpi-value" style={{ fontSize: 18 }}>{fmt(supplier.total_payments)}</div></div>
        <div className="mq-kpi" style={{ ['--mq-kpi-color' as string]: '#c0362c' }}><div className="mq-kpi-label">বর্তমান দেনা</div><div className="mq-kpi-value" style={{ fontSize: 18 }}>{fmt(supplier.current_payable)}</div></div>
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

export function SupplierPayModal({ preset, suppliers, onClose, onDone }: {
  preset: Supplier | null; suppliers: Supplier[]; onClose: () => void; onDone: () => void;
}): React.ReactElement {
  const { business, fail, notify } = useApp();
  const { fmt } = useMoney();
  const [sid, setSid] = useState(preset?.id ? String(preset.id) : '');
  const [payable, setPayable] = useState<number | null>(preset?.current_payable ?? null);
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
    if (!sid) { setPayable(null); return; }
    (async () => {
      try {
        const p = await call<Supplier & { current_payable: number }>('supplier.profile', { id: Number(sid) });
        setPayable(p.current_payable);
      } catch { /* noop */ }
    })();
  }, [sid]);

  const submit = async (withReceipt: boolean): Promise<void> => {
    if (!sid) { notify('error', 'সরবরাহকারী নির্বাচন করুন।'); return; }
    const amt = Math.round((parseFloat(amount) || 0) * 100);
    if (amt <= 0) { notify('error', 'সঠিক টাকার পরিমাণ দিন।'); return; }
    if (!accountId) { notify('error', 'হিসাব নির্বাচন করুন।'); return; }
    setBusy(true);
    try {
      const r = await call<{ id: number; reference: string; remaining_payable: number }>('supplier.pay', {
        input: { supplier_id: Number(sid), account_id: Number(accountId), method, amount: amt, notes: notes.trim() || null },
      });
      notify('success', `পেমেন্ট দেওয়া হয়েছে। অবশিষ্ট দেনা: ${fmt(r.remaining_payable)}`);
      if (withReceipt && business) {
        const s = suppliers.find((x) => x.id === Number(sid));
        const html = paymentReceiptHtml(business, 'supplier',
          { reference: r.reference, paid_at: new Date().toISOString(), method, amount: amt, account_name: accounts.find((a) => a.id === Number(accountId))?.name },
          s?.name || '', payable ?? 0, r.remaining_payable);
        await api.preview({ html, title: `রসিদ ${r.reference}` });
      }
      onDone();
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="সরবরাহকারী পেমেন্ট" onClose={onClose} footer={(
      <>
        <button className="mq-btn" onClick={onClose}>বাতিল করুন</button>
        <button className="mq-btn" onClick={() => submit(true)} disabled={busy}><Printer /> সংরক্ষণ + রসিদ</button>
        <button className="mq-btn primary" onClick={() => submit(false)} disabled={busy}>{busy ? 'প্রক্রিয়াকরণ…' : 'সংরক্ষণ করুন'}</button>
      </>
    )}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="সরবরাহকারী" required>
          <select className="mq-select" value={sid} onChange={(e) => setSid(e.target.value)}>
            <option value="">নির্বাচন করুন</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name} — দেনা {fmt(s.current_payable ?? 0)}</option>)}
          </select>
        </Field>
        {payable !== null && <div className="mq-alert info">বর্তমান দেনা: <strong>{fmt(payable)}</strong></div>}
        <Field label="টাকার পরিমাণ (৳)" required>
          <input className="mq-input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="০" autoFocus />
        </Field>
        <PayMethodGrid value={method} onChange={setMethod} accounts={accounts} onAutoAccount={(id) => setAccountId(String(id))} />
        <Field label="হিসাব" required>
          <select className="mq-select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({fmt(a.current_balance ?? 0)})</option>)}
          </select>
        </Field>
        <Field label="মন্তব্য"><input className="mq-input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

import React, { useCallback, useEffect, useState } from 'react';
import { Landmark, Plus, Search } from 'lucide-react';
import { Layout } from '../components/Layout';
import { PageHeader, Modal, EmptyState, Badge, Pagination, Field, Spinner, useDebouncedValue } from '../components/ui';
import { useDateRange } from '../components/DateRange';
import { call } from '../api';
import { useApp, useMoney } from '../store';
import { MFS_PROVIDERS, MFS_TXN_BN, MfsProvider, MfsTxnType } from '@shared/constants';
import type { FinancialAccount, Paged } from '@shared/types';

export function Agent(): React.ReactElement {
  const { can, fail, notify } = useApp();
  const { fmt } = useMoney();
  const { range, RangePicker } = useDateRange('thisMonth');
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);
  const [provider, setProvider] = useState('');
  const [txnType, setTxnType] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<Record<string, unknown>>>({ rows: [], total: 0, page: 1, pageSize: 50 });
  const [summary, setSummary] = useState<{ byProvider: Record<string, unknown>[]; total: Record<string, unknown> } | null>(null);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, s] = await Promise.all([
        call<Paged<Record<string, unknown>>>('mfs.list', { opts: { q: debouncedQ, provider: provider || undefined, txn_type: txnType || undefined, from: range.fromUtc, to: range.toUtc, page, pageSize: 50 } }),
        call<{ byProvider: Record<string, unknown>[]; total: Record<string, unknown> }>('mfs.summary', { from: range.fromUtc, to: range.toUtc }),
      ]);
      setData(r); setSummary(s);
    } catch (e) { fail(e); }
    finally { setLoading(false); }
  }, [debouncedQ, provider, txnType, range.fromUtc, range.toUtc, page, fail]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [debouncedQ, provider, txnType, range.fromUtc, range.toUtc]);

  const t = summary?.total;

  return (
    <Layout title="এজেন্ট ব্যাংকিং" sub="বিকাশ, নগদ, রকেট, উপায় — ম্যানুয়াল এজেন্ট হিসাব">
      <PageHeader title="এজেন্ট ব্যাংকিং" sub={`${range.from} → ${range.to}`}>
        <RangePicker />
        {can('mfs.create') && <button className="mq-btn primary" onClick={() => setFormOpen(true)}><Plus /> নতুন লেনদেন</button>}
      </PageHeader>

      <div className="mq-alert info" style={{ marginBottom: 14 }}>
        <Landmark />
        <div>এটি <strong>ম্যানুয়াল এজেন্ট হিসাব</strong> — ক্যাশ ইন/আউট, চার্জ ও কমিশনের বইপত্র রাখুন। কোনো লাইভ প্রোভাইডার ইন্টিগ্রেশন নেই।</div>
      </div>

      {summary && (
        <div className="mq-grid cols-3" style={{ marginBottom: 14 }}>
          <div className="mq-kpi" style={{ ['--mq-kpi-color' as string]: '#0e63b6' }}>
            <div className="mq-kpi-label">মোট লেনদেন</div>
            <div className="mq-kpi-value">{String(t?.txn_count ?? 0)}টি</div>
            <div className="mq-kpi-sub">ভলিউম: {fmt(Number(t?.volume ?? 0))}</div>
          </div>
          <div className="mq-kpi" style={{ ['--mq-kpi-color' as string]: '#9a6200' }}>
            <div className="mq-kpi-label">মোট চার্জ</div>
            <div className="mq-kpi-value">{fmt(Number(t?.charges ?? 0))}</div>
            <div className="mq-kpi-sub">গ্রাহকের কাছ থেকে আদায়</div>
          </div>
          <div className="mq-kpi" style={{ ['--mq-kpi-color' as string]: '#12805c' }}>
            <div className="mq-kpi-label">মোট কমিশন</div>
            <div className="mq-kpi-value">{fmt(Number(t?.commission ?? 0))}</div>
            <div className="mq-kpi-sub">আয় হিসেবে গণ্য</div>
          </div>
        </div>
      )}

      {summary && summary.byProvider.length > 0 && (
        <div className="mq-table-wrap" style={{ marginBottom: 14 }}>
          <table className="mq-table">
            <thead><tr><th>প্রোভাইডার</th><th className="num">লেনদেন</th><th className="num">ক্যাশ ইন</th><th className="num">ক্যাশ আউট</th><th className="num">ভলিউম</th><th className="num">চার্জ</th><th className="num">কমিশন</th></tr></thead>
            <tbody>
              {summary.byProvider.map((p) => (
                <tr key={String(p.provider)}>
                  <td><strong>{MFS_PROVIDERS.find((x) => x.id === p.provider)?.bn || String(p.provider)}</strong></td>
                  <td className="num">{String(p.txn_count)}</td>
                  <td className="num">{fmt(Number(p.cash_in))}</td>
                  <td className="num">{fmt(Number(p.cash_out))}</td>
                  <td className="num">{fmt(Number(p.volume))}</td>
                  <td className="num">{fmt(Number(p.charges))}</td>
                  <td className="num">{fmt(Number(p.commission))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mq-toolbar">
        <div className="grow mq-search-wrap"><Search /><input className="mq-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="রেফারেন্স, মোবাইল বা ট্রানজেকশন আইডি" /></div>
        <select className="mq-select" style={{ width: 150 }} value={provider} onChange={(e) => setProvider(e.target.value)}>
          <option value="">সব প্রোভাইডার</option>
          {MFS_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.bn}</option>)}
        </select>
        <select className="mq-select" style={{ width: 170 }} value={txnType} onChange={(e) => setTxnType(e.target.value)}>
          <option value="">সব ধরন</option>
          {(Object.keys(MFS_TXN_BN) as MfsTxnType[]).map((x) => <option key={x} value={x}>{MFS_TXN_BN[x]}</option>)}
        </select>
      </div>

      {loading ? <Spinner /> : data.rows.length === 0 ? (
        <div className="mq-card"><EmptyState icon={<Landmark />} title="কোনো এজেন্ট লেনদেন নেই" /></div>
      ) : (
        <div className="mq-table-wrap">
          <table className="mq-table">
            <thead><tr><th>রেফারেন্স</th><th>তারিখ</th><th>প্রোভাইডার</th><th>ধরন</th><th>মোবাইল</th><th className="num">টাকা</th><th className="num">চার্জ</th><th className="num">কমিশন</th><th>অপারেটর</th></tr></thead>
            <tbody>
              {data.rows.map((m) => (
                <tr key={String(m.id)}>
                  <td><strong>{String(m.reference)}</strong></td>
                  <td>{new Date(String(m.occurred_at)).toLocaleString('bn-BD')}</td>
                  <td>{MFS_PROVIDERS.find((x) => x.id === m.provider)?.bn}</td>
                  <td><Badge tone="blue">{MFS_TXN_BN[String(m.txn_type) as MfsTxnType]}</Badge></td>
                  <td>{String(m.customer_mobile || '—')}</td>
                  <td className="num">{fmt(Number(m.amount))}</td>
                  <td className="num">{fmt(Number(m.charge))}</td>
                  <td className="num">{fmt(Number(m.commission))}</td>
                  <td>{String(m.operator_name || '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
      {formOpen && <MfsForm onClose={() => setFormOpen(false)} onSaved={() => { setFormOpen(false); load(); notify('success', 'এজেন্ট লেনদেন সংরক্ষণ করা হয়েছে।'); }} />}
    </Layout>
  );
}

function MfsForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }): React.ReactElement {
  const { fail } = useApp();
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [f, setF] = useState({
    provider: 'bkash' as MfsProvider, txn_type: 'CASH_IN' as MfsTxnType,
    customer_mobile: '', provider_txn_id: '', amount: '', charge: '', commission: '',
    cash_account_id: '', notes: '',
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const a = await call<FinancialAccount[]>('account.list');
        setAccounts(a);
        const cash = a.find((x) => x.code === 'CASH');
        if (cash) setF((p) => ({ ...p, cash_account_id: String(cash.id) }));
      } catch (e) { fail(e); }
    })();
  }, [fail]);

  const submit = async (): Promise<void> => {
    const amt = Math.round((parseFloat(f.amount) || 0) * 100);
    if (amt <= 0 || !f.cash_account_id) return;
    setBusy(true);
    try {
      await call('mfs.create', {
        input: {
          provider: f.provider, txn_type: f.txn_type,
          customer_mobile: f.customer_mobile.trim() || null, provider_txn_id: f.provider_txn_id.trim() || null,
          amount: amt,
          charge: f.charge.trim() ? Math.round((parseFloat(f.charge) || 0) * 100) : 0,
          commission: f.commission.trim() ? Math.round((parseFloat(f.commission) || 0) * 100) : 0,
          cash_account_id: Number(f.cash_account_id), notes: f.notes.trim() || null,
        },
      });
      onSaved();
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  };

  return (
    <Modal title="নতুন এজেন্ট লেনদেন" onClose={onClose} size="lg" footer={(
      <>
        <button className="mq-btn" onClick={onClose}>বাতিল করুন</button>
        <button className="mq-btn primary" onClick={submit} disabled={busy}>সংরক্ষণ করুন</button>
      </>
    )}>
      <div className="mq-form-grid">
        <Field label="প্রোভাইডার" required>
          <select className="mq-select" value={f.provider} onChange={(e) => setF({ ...f, provider: e.target.value as MfsProvider })}>
            {MFS_PROVIDERS.map((p) => <option key={p.id} value={p.id}>{p.bn}</option>)}
          </select>
        </Field>
        <Field label="লেনদেনের ধরন" required>
          <select className="mq-select" value={f.txn_type} onChange={(e) => setF({ ...f, txn_type: e.target.value as MfsTxnType })}>
            {(Object.keys(MFS_TXN_BN) as MfsTxnType[]).map((x) => <option key={x} value={x}>{MFS_TXN_BN[x]}</option>)}
          </select>
        </Field>
        <Field label="টাকার পরিমাণ (৳)" required><input className="mq-input" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} autoFocus /></Field>
        <Field label="গ্রাহকের মোবাইল"><input className="mq-input" value={f.customer_mobile} onChange={(e) => setF({ ...f, customer_mobile: e.target.value })} placeholder="01XXXXXXXXX" /></Field>
        <Field label="চার্জ (৳)"><input className="mq-input" inputMode="decimal" value={f.charge} onChange={(e) => setF({ ...f, charge: e.target.value })} /></Field>
        <Field label="কমিশন (৳)"><input className="mq-input" inputMode="decimal" value={f.commission} onChange={(e) => setF({ ...f, commission: e.target.value })} /></Field>
        <Field label="প্রোভাইডার ট্রানজেকশন আইডি"><input className="mq-input" value={f.provider_txn_id} onChange={(e) => setF({ ...f, provider_txn_id: e.target.value })} placeholder="যেমন: TRX123..." /></Field>
        <Field label="নগদ হিসাব" required>
          <select className="mq-select" value={f.cash_account_id} onChange={(e) => setF({ ...f, cash_account_id: e.target.value })}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <div style={{ gridColumn: '1 / -1' }}>
          <Field label="মন্তব্য"><input className="mq-input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        </div>
      </div>
    </Modal>
  );
}

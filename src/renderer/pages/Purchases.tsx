import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, Eye, Trash2, X, FileText, Printer, Ban, RotateCcw, ShoppingBag, Undo2, CheckCircle2 } from 'lucide-react';
import { Layout } from '../components/Layout';
import { PageHeader, Modal, EmptyState, Badge, Pagination, Field, Spinner, useDebouncedValue, paymentBadge , PayMethodGrid} from '../components/ui';
import { useDateRange } from '../components/DateRange';
import { call, api } from '../api';
import { useApp, useMoney } from '../store';
import { formatQty, toMilli } from '@shared/qty';
import { PAYMENT_METHOD_BN, PaymentMethod } from '@shared/constants';
import type { FinancialAccount, Paged, Product, Purchase, Supplier } from '@shared/types';
import { purchaseHtml } from '../components/PrintDocs';

export function Purchases(): React.ReactElement {
  const [tab, setTab] = useState<'new' | 'list' | 'returns'>('list');
  const [params] = useSearchParams();
  useEffect(() => { if (params.get('new') === '1') setTab('new'); }, [params]);

  return (
    <Layout title="ক্রয়" sub="সরবরাহকারী থেকে পণ্য ক্রয়">
      <div className="mq-tabs">
        <button className={tab === 'new' ? 'active' : ''} onClick={() => setTab('new')}><Plus /> নতুন ক্রয়</button>
        <button className={tab === 'list' ? 'active' : ''} onClick={() => setTab('list')}><ShoppingBag /> ক্রয় তালিকা</button>
        <button className={tab === 'returns' ? 'active' : ''} onClick={() => setTab('returns')}><Undo2 /> ক্রয় ফেরত</button>
      </div>
      {tab === 'new' && <NewPurchase onDone={() => setTab('list')} />}
      {tab === 'list' && <PurchaseList />}
      {tab === 'returns' && <PurchaseReturnList />}
    </Layout>
  );
}

interface BuyLine {
  key: string;
  product: Product;
  qty: number;
  cost: number;
  selling?: string;
  batch?: string;
  expiry?: string;
}

function NewPurchase({ onDone }: { onDone: () => void }): React.ReactElement {
  const { can, fail, notify } = useApp();
  const { fmt } = useMoney();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierId, setSupplierId] = useState<number | null>(null);
  const [supplierInvoice, setSupplierInvoice] = useState('');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [lines, setLines] = useState<BuyLine[]>([]);
  const [invDiscount, setInvDiscount] = useState('');
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash');
  const [payAccountId, setPayAccountId] = useState<number | null>(null);
  const [paid, setPaid] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const debounced = useDebouncedValue(search, 200);

  useEffect(() => {
    (async () => {
      try {
        const [s, a] = await Promise.all([
          call<Paged<Supplier>>('supplier.list', { opts: { page: 1, pageSize: 500, status: 'active' } }),
          call<FinancialAccount[]>('account.list'),
        ]);
        setSuppliers(s.rows);
        setAccounts(a);
        const cash = a.find((x) => x.code === 'CASH');
        if (cash) setPayAccountId(cash.id);
      } catch (e) { fail(e); }
    })();
  }, [fail]);

  useEffect(() => {
    if (!debounced.trim()) { setResults([]); return; }
    (async () => {
      try {
        const r = await call<Product[]>('product.search', { q: debounced.trim() });
        setResults(r);
      } catch { /* noop */ }
    })();
  }, [debounced]);

  const totals = useMemo(() => {
    const sub = lines.reduce((a, l) => a + Math.round(l.cost * l.qty), 0);
    const disc = invDiscount.trim() ? Math.round((parseFloat(invDiscount) || 0) * 100) : 0;
    const total = Math.max(0, sub - Math.min(disc, sub));
    const paidAmt = paid.trim() ? Math.round((parseFloat(paid) || 0) * 100) : 0;
    return { sub, disc: Math.min(disc, sub), total, paid: paidAmt, due: Math.max(0, total - paidAmt) };
  }, [lines, invDiscount, paid]);

  const submit = async (): Promise<void> => {
    if (!lines.length) { notify('error', 'কমপক্ষে একটি পণ্য যোগ করুন।'); return; }
    if (totals.paid > totals.total) { notify('error', 'পেমেন্ট মোটের চেয়ে বেশি হতে পারবে না।'); return; }
    if (totals.due > 0 && !supplierId) { notify('error', 'বকেয়া রাখতে সরবরাহকারী নির্বাচন করুন।'); return; }
    setBusy(true);
    try {
      const r = await call<{ reference: string; total: number; paid: number; due: number }>('purchase.complete', {
        input: {
          supplier_id: supplierId,
          supplier_invoice: supplierInvoice.trim() || null,
          items: lines.map((l) => ({
            product_id: l.product.id,
            qty_milli: toMilli(l.qty),
            unit_cost: l.cost,
            new_selling_price: l.selling?.trim() ? Math.round((parseFloat(l.selling) || 0) * 100) : undefined,
            batch_no: l.batch?.trim() || null,
            expiry_date: l.expiry || null,
          })),
          invoice_discount: totals.disc,
          payments: totals.paid > 0 && payAccountId ? [{ account_id: payAccountId, method: payMethod, amount: totals.paid }] : [],
          notes: notes.trim() || null,
        },
      });
      notify('success', `ক্রয় সম্পন্ন: ${r.reference} — বকেয়া ${fmt(r.due)}`);
      onDone();
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  };

  if (!can('purchase.create')) return <div className="mq-alert warn">ক্রয় করার অনুমতি আপনার নেই।</div>;

  return (
    <div className="mq-grid cols-2" style={{ gridTemplateColumns: 'minmax(0,1fr) 360px' }}>
      <div className="mq-card mq-card-pad">
        <div className="mq-form-grid">
          <Field label="সরবরাহকারী (বকেয়ার জন্য আবশ্যক)">
            <select className="mq-select" value={supplierId ?? ''} onChange={(e) => setSupplierId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">নির্বাচন করুন</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="সরবরাহকারীর ইনভয়েস নং"><input className="mq-input" value={supplierInvoice} onChange={(e) => setSupplierInvoice(e.target.value)} placeholder="ঐচ্ছিক" /></Field>
        </div>
        <div className="mq-mt">
          <Field label="পণ্য খুঁজে যোগ করুন">
            <div className="mq-pos-search">
              <div className="mq-search-wrap"><Search /><input className="mq-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="নাম, SKU বা বারকোড" /></div>
              {results.length > 0 && (
                <div className="mq-pos-results">
                  {results.map((p) => (
                    <div key={p.id} className="mq-pos-result" onClick={() => {
                      setLines((l) => [...l, { key: `${p.id}-${Date.now()}`, product: p, qty: 1, cost: p.purchase_price }]);
                      setSearch(''); setResults([]);
                    }}>
                      <div><div className="nm">{p.name}</div><div className="meta">স্টক: {formatQty(p.stock_milli)}</div></div>
                      <div className="pr">{fmt(p.purchase_price)}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Field>
        </div>
        <div className="mq-mt">
          {lines.length === 0 ? <EmptyState title="কোনো পণ্য যোগ হয়নি" /> : (
            <div className="mq-table-wrap">
              <table className="mq-table">
                <thead><tr><th>পণ্য</th><th>পরিমাণ</th><th>ক্রয়দর</th><th>নতুন বিক্রয়দর</th><th>ব্যাচ / মেয়াদ</th><th className="num">মোট</th><th></th></tr></thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.key}>
                      <td><strong>{l.product.name}</strong></td>
                      <td><input className="mq-input" style={{ width: 80 }} inputMode="decimal" value={l.qty} onChange={(e) => setLines((x) => x.map((y) => (y.key === l.key ? { ...y, qty: parseFloat(e.target.value) || 0 } : y)))} /></td>
                      <td><input className="mq-input" style={{ width: 100 }} inputMode="decimal" value={l.cost / 100} onChange={(e) => setLines((x) => x.map((y) => (y.key === l.key ? { ...y, cost: Math.round((parseFloat(e.target.value) || 0) * 100) } : y)))} /></td>
                      <td><input className="mq-input" style={{ width: 100 }} inputMode="decimal" placeholder={String(l.product.selling_price / 100)} value={l.selling || ''} onChange={(e) => setLines((x) => x.map((y) => (y.key === l.key ? { ...y, selling: e.target.value } : y)))} /></td>
                      <td>
                        <div className="mq-flex" style={{ gap: 4 }}>
                          <input className="mq-input" style={{ width: 80 }} placeholder="ব্যাচ" value={l.batch || ''} onChange={(e) => setLines((x) => x.map((y) => (y.key === l.key ? { ...y, batch: e.target.value } : y)))} />
                          <input className="mq-input" style={{ width: 130 }} type="date" value={l.expiry || ''} onChange={(e) => setLines((x) => x.map((y) => (y.key === l.key ? { ...y, expiry: e.target.value } : y)))} />
                        </div>
                      </td>
                      <td className="num">{fmt(Math.round(l.cost * l.qty))}</td>
                      <td><button className="mq-mini-btn danger" onClick={() => setLines((x) => x.filter((y) => y.key !== l.key))}><X /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      <div className="mq-card mq-card-pad" style={{ alignSelf: 'start', position: 'sticky', top: 0 }}>
        <div className="mq-totals" style={{ padding: 0 }}>
          <div className="row"><span>উপমোট</span><strong>{fmt(totals.sub)}</strong></div>
          <Field label="ছাড় (৳)"><input className="mq-input" inputMode="decimal" value={invDiscount} onChange={(e) => setInvDiscount(e.target.value)} placeholder="০" /></Field>
          <div className="row grand"><span>সর্বমোট</span><span>{fmt(totals.total)}</span></div>
          <Field label="পরিশোধ (৳)"><input className="mq-input" inputMode="decimal" value={paid} onChange={(e) => setPaid(e.target.value)} placeholder="০" /></Field>
          <PayMethodGrid value={payMethod} onChange={setPayMethod} accounts={accounts} onAutoAccount={setPayAccountId} />
          <Field label="হিসাব">
            <select className="mq-select" value={payAccountId ?? ''} onChange={(e) => setPayAccountId(Number(e.target.value))}>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <div className="row"><span>বকেয়া</span><span className="due">{fmt(totals.due)}</span></div>
          <Field label="মন্তব্য"><input className="mq-input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <button className="mq-btn success lg block" onClick={submit} disabled={busy || !lines.length}><CheckCircle2 /> {busy ? 'প্রক্রিয়াকরণ…' : 'ক্রয় সম্পন্ন করুন'}</button>
        </div>
      </div>
    </div>
  );
}

function PurchaseList(): React.ReactElement {
  const { business, can, fail, notify } = useApp();
  const { fmt } = useMoney();
  const { range, RangePicker } = useDateRange('thisMonth');
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<Purchase>>({ rows: [], total: 0, page: 1, pageSize: 50 });
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<{ purchase: Record<string, unknown> & { id: number; reference: string }; items: Record<string, unknown>[]; payments: Record<string, unknown>[] } | null>(null);
  const [voidTarget, setVoidTarget] = useState<Purchase | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [returnTarget, setReturnTarget] = useState<{ purchase: Record<string, unknown> & { id: number; reference: string }; items: (Record<string, unknown> & { id: number; product_id: number; product_name: string; qty_milli: number; returned_milli: number })[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call<Paged<Purchase>>('purchase.list', { opts: { q: debouncedQ, from: range.fromUtc, to: range.toUtc, page, pageSize: 50 } });
      setData(r);
    } catch (e) { fail(e); }
    finally { setLoading(false); }
  }, [debouncedQ, range.fromUtc, range.toUtc, page, fail]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [debouncedQ, range.fromUtc, range.toUtc]);

  const openDetail = async (id: number): Promise<void> => {
    try {
      const d = await call<{ purchase: Record<string, unknown> & { id: number; reference: string }; items: Record<string, unknown>[]; payments: Record<string, unknown>[] }>('purchase.detail', { id });
      setDetail(d);
    } catch (e) { fail(e); }
  };

  const printDetail = async (mode: 'print' | 'pdf' | 'preview'): Promise<void> => {
    if (!detail || !business) return;
    const html = purchaseHtml(business, detail.purchase, detail.items);
    if (mode === 'preview') await api.preview({ html, title: `ক্রয় ${detail.purchase.reference}` });
    else if (mode === 'pdf') {
      const r = await api.pdf({ html, pageSize: 'A4' });
      notify(r.ok ? 'success' : 'error', r.ok ? 'PDF সংরক্ষণ করা হয়েছে।' : 'PDF তৈরি করা যায়নি।');
    } else {
      const r = await api.print({ html, silent: false });
      if (!r.ok) notify('error', 'প্রিন্ট করা যায়নি।');
    }
  };

  const doVoid = async (): Promise<void> => {
    if (!voidTarget || !voidReason.trim()) { notify('error', 'বাতিলের কারণ লিখুন।'); return; }
    setBusy(true);
    try {
      await call('purchase.void', { id: voidTarget.id, reason: voidReason.trim() });
      notify('success', 'ক্রয় বাতিল করা হয়েছে।');
      setVoidTarget(null); setVoidReason(''); setDetail(null); load();
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader title="ক্রয় তালিকা" sub={`${range.from} → ${range.to}`}>
        <RangePicker />
      </PageHeader>
      <div className="mq-toolbar">
        <div className="grow mq-search-wrap"><Search /><input className="mq-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="রেফারেন্স, ইনভয়েস বা সরবরাহকারী খুঁজুন" /></div>
      </div>
      {loading ? <Spinner /> : data.rows.length === 0 ? (
        <div className="mq-card"><EmptyState icon={<ShoppingBag />} title="কোনো ক্রয় রেকর্ড নেই" /></div>
      ) : (
        <div className="mq-table-wrap">
          <table className="mq-table">
            <thead><tr><th>রেফারেন্স</th><th>তারিখ</th><th>সরবরাহকারী</th><th className="num">মোট</th><th className="num">পরিশোধ</th><th className="num">বকেয়া</th><th className="center">কার্যক্রম</th></tr></thead>
            <tbody>
              {data.rows.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.reference}</strong></td>
                  <td>{new Date(p.purchased_at).toLocaleString('bn-BD')}</td>
                  <td>{p.supplier_name || '—'}</td>
                  <td className="num">{fmt(p.total)}</td>
                  <td className="num">{fmt(p.paid)}</td>
                  <td className="num">{fmt(p.due)}</td>
                  <td><div className="mq-row-actions">
                    <button className="mq-mini-btn" title="বিস্তারিত" onClick={() => openDetail(p.id)}><Eye /></button>
                    {can('purchase.return') && <button className="mq-mini-btn" title="ফেরত" onClick={async () => {
                      const d = await call<{ purchase: Record<string, unknown> & { id: number; reference: string }; items: (Record<string, unknown> & { id: number; product_id: number; product_name: string; qty_milli: number; returned_milli: number })[] }>('purchase.detail', { id: p.id });
                      setReturnTarget(d);
                    }}><RotateCcw /></button>}
                    {can('purchase.return') && <button className="mq-mini-btn danger" title="বাতিল" onClick={() => setVoidTarget(p)}><Ban /></button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />

      {detail && (
        <Modal title={`ক্রয় ${detail.purchase.reference}`} sub={new Date(String(detail.purchase.purchased_at)).toLocaleString('bn-BD')} onClose={() => setDetail(null)} size="lg" footer={(
          <>
            <button className="mq-btn" onClick={() => printDetail('preview')}><Eye /> প্রিভিউ</button>
            <button className="mq-btn" onClick={() => printDetail('pdf')}><FileText /> PDF</button>
            <button className="mq-btn primary" onClick={() => printDetail('print')}><Printer /> প্রিন্ট</button>
          </>
        )}>
          <p>সরবরাহকারী: <strong>{String(detail.purchase.supplier_name || '—')}</strong></p>
          <div className="mq-table-wrap">
            <table className="mq-table">
              <thead><tr><th>পণ্য</th><th className="num">পরিমাণ</th><th className="num">ক্রয়দর</th><th className="num">মোট</th></tr></thead>
              <tbody>
                {detail.items.map((it, i) => (
                  <tr key={i}><td>{String(it.product_name)}</td><td className="num">{formatQty(Number(it.qty_milli))}</td><td className="num">{fmt(Number(it.unit_cost))}</td><td className="num">{fmt(Number(it.line_total))}</td></tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={3}>সর্বমোট</td><td className="num">{fmt(Number(detail.purchase.total))}</td></tr>
                <tr><td colSpan={3}>পরিশোধ</td><td className="num">{fmt(Number(detail.purchase.paid))}</td></tr>
                <tr><td colSpan={3}>বকেয়া</td><td className="num">{fmt(Number(detail.purchase.due))}</td></tr>
              </tfoot>
            </table>
          </div>
        </Modal>
      )}

      {voidTarget && (
        <Modal title="ক্রয় বাতিল করুন" sub={voidTarget.reference} onClose={() => { setVoidTarget(null); setVoidReason(''); }} footer={(
          <>
            <button className="mq-btn" onClick={() => { setVoidTarget(null); setVoidReason(''); }}>ফিরে যান</button>
            <button className="mq-btn danger" onClick={doVoid} disabled={busy || !voidReason.trim()}>বাতিল নিশ্চিত করুন</button>
          </>
        )}>
          <p>এই ক্রয়টি বাতিল করলে স্টক, সরবরাহকারীর দেনা ও হিসাব সমন্বয় করা হবে।</p>
          <Field label="বাতিলের কারণ" required><input className="mq-input" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} autoFocus /></Field>
        </Modal>
      )}

      {returnTarget && <PurchaseReturnModal data={returnTarget} onClose={() => setReturnTarget(null)} onDone={() => { setReturnTarget(null); load(); }} />}
    </div>
  );
}

function PurchaseReturnModal({ data, onClose, onDone }: {
  data: { purchase: Record<string, unknown> & { id: number; reference: string }; items: (Record<string, unknown> & { id: number; product_id: number; product_name: string; qty_milli: number; returned_milli: number })[] };
  onClose: () => void; onDone: () => void;
}): React.ReactElement {
  const { fail, notify } = useApp();
  const [qtys, setQtys] = useState<Record<number, string>>({});
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [accountId, setAccountId] = useState<string>('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const a = await call<FinancialAccount[]>('account.list');
        setAccounts(a);
      } catch (e) { fail(e); }
    })();
  }, [fail]);

  const submit = async (): Promise<void> => {
    const items = data.items
      .map((it) => ({ purchase_item_id: it.id, qty_milli: qtys[it.id] ? toMilli(parseFloat(qtys[it.id]) || 0) : 0 }))
      .filter((x) => x.qty_milli > 0);
    if (!items.length) { notify('error', 'কমপক্ষে একটি পণ্যের ফেরত পরিমাণ দিন।'); return; }
    setBusy(true);
    try {
      await call('purchase.return', { input: { purchase_id: data.purchase.id, items, account_id: accountId ? Number(accountId) : null, reason: reason.trim() || undefined } });
      notify('success', 'ক্রয় ফেরত সম্পন্ন হয়েছে।');
      onDone();
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={`ক্রয় ফেরত — ${data.purchase.reference}`} onClose={onClose} size="lg" footer={(
      <>
        <button className="mq-btn" onClick={onClose}>বাতিল করুন</button>
        <button className="mq-btn primary" onClick={submit} disabled={busy}>{busy ? 'প্রক্রিয়াকরণ…' : 'ফেরত নিশ্চিত করুন'}</button>
      </>
    )}>
      <div className="mq-table-wrap">
        <table className="mq-table">
          <thead><tr><th>পণ্য</th><th className="num">ক্রীত</th><th className="num">ফেরতযোগ্য</th><th>ফেরত পরিমাণ</th></tr></thead>
          <tbody>
            {data.items.map((it) => {
              const avail = it.qty_milli - (it.returned_milli ?? 0);
              return (
                <tr key={it.id}>
                  <td>{it.product_name}</td>
                  <td className="num">{formatQty(it.qty_milli)}</td>
                  <td className="num">{formatQty(avail)}</td>
                  <td><input className="mq-input" style={{ width: 110 }} inputMode="decimal" value={qtys[it.id] || ''} onChange={(e) => setQtys({ ...qtys, [it.id]: e.target.value })} disabled={avail <= 0} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mq-form-grid mq-mt">
        <Field label="টাকা ফেরতের হিসাব (ঐচ্ছিক — নগদ ফেরত পেলে)">
          <select className="mq-select" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            <option value="">শুধু দেনা সমন্বয়</option>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="কারণ"><input className="mq-input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function PurchaseReturnList(): React.ReactElement {
  const { fail } = useApp();
  const { fmt } = useMoney();
  const { range, RangePicker } = useDateRange('thisMonth');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<Record<string, unknown>>>({ rows: [], total: 0, page: 1, pageSize: 50 });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call<Paged<Record<string, unknown>>>('purchase.returnList', { opts: { from: range.fromUtc, to: range.toUtc, page, pageSize: 50 } });
      setData(r);
    } catch (e) { fail(e); }
    finally { setLoading(false); }
  }, [range.fromUtc, range.toUtc, page, fail]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <PageHeader title="ক্রয় ফেরত" sub={`${range.from} → ${range.to}`}>
        <RangePicker />
      </PageHeader>
      {loading ? <Spinner /> : data.rows.length === 0 ? (
        <div className="mq-card"><EmptyState icon={<Undo2 />} title="কোনো ফেরত রেকর্ড নেই" /></div>
      ) : (
        <div className="mq-table-wrap">
          <table className="mq-table">
            <thead><tr><th>রেফারেন্স</th><th>ক্রয়</th><th>সরবরাহকারী</th><th>তারিখ</th><th className="num">ক্রেডিট</th><th>কারণ</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={String(r.id)}>
                  <td><strong>{String(r.reference)}</strong></td>
                  <td>{String(r.purchase_ref)}</td>
                  <td>{String(r.supplier_name || '—')}</td>
                  <td>{new Date(String(r.returned_at)).toLocaleString('bn-BD')}</td>
                  <td className="num">{fmt(Number(r.total_credit))}</td>
                  <td>{String(r.reason || '—')}</td>
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

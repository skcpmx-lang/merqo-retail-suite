import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ScanBarcode, Search, Trash2, Pause, Play, Plus, Minus, X, Printer, FileText,
  RotateCcw, Ban, Eye, CheckCircle2, ShoppingCart, ListOrdered, Undo2,
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { PageHeader, Modal, Confirm, EmptyState, Badge, paymentBadge, Pagination, Field, Spinner, useDebouncedValue } from '../components/ui';
import { useDateRange } from '../components/DateRange';
import { call, api } from '../api';
import { useApp, useMoney } from '../store';
import { formatQty, toMilli, fromMilli } from '@shared/qty';
import { PAYMENT_METHOD_BN, PaymentMethod } from '@shared/constants';
import type { Customer, FinancialAccount, Paged, Product, Sale } from '@shared/types';
import { saleInvoiceHtml, InvoiceItemRow } from '../components/PrintDocs';

interface CartLine {
  key: string;
  product: Product;
  qty: number; // display units
  price: number; // paisa per unit
  discount: number; // paisa per line
}

const PAY_METHODS: { id: PaymentMethod; label: string }[] = (Object.keys(PAYMENT_METHOD_BN) as PaymentMethod[]).map((m) => ({ id: m, label: PAYMENT_METHOD_BN[m] }));

export function Pos(): React.ReactElement {
  const [tab, setTab] = useState<'pos' | 'invoices' | 'held' | 'returns'>('pos');
  const [params] = useSearchParams();
  useEffect(() => {
    if (params.get('invoice')) setTab('invoices');
  }, [params]);

  return (
    <Layout title="বিক্রয়" sub="POS টার্মিনাল, ইনভয়েস ও ফেরত">
      <div className="mq-tabs">
        <button className={tab === 'pos' ? 'active' : ''} onClick={() => setTab('pos')}><ShoppingCart /> POS টার্মিনাল</button>
        <button className={tab === 'invoices' ? 'active' : ''} onClick={() => setTab('invoices')}><ListOrdered /> ইনভয়েস তালিকা</button>
        <button className={tab === 'held' ? 'active' : ''} onClick={() => setTab('held')}><Pause /> হোল্ড করা বিক্রয়</button>
        <button className={tab === 'returns' ? 'active' : ''} onClick={() => setTab('returns')}><Undo2 /> বিক্রয় ফেরত</button>
      </div>
      {tab === 'pos' && <PosTerminal />}
      {tab === 'invoices' && <InvoiceList />}
      {tab === 'held' && <HeldList onRestore={() => setTab('pos')} />}
      {tab === 'returns' && <ReturnList />}
    </Layout>
  );
}

/* ================= POS Terminal ================= */

function PosTerminal({ restoreId }: { restoreId?: number }): React.ReactElement {
  const { business, can, notify, fail } = useApp();
  const { fmt } = useMoney();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [barcode, setBarcode] = useState('');
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<Product[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [invDiscount, setInvDiscount] = useState('');
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [payMethod, setPayMethod] = useState<PaymentMethod>('cash');
  const [payAccountId, setPayAccountId] = useState<number | null>(null);
  const [tendered, setTendered] = useState('');
  const [payments, setPayments] = useState<{ account_id: number; method: string; amount: number }[]>([]);
  const [busy, setBusy] = useState(false);
  const [holdOpen, setHoldOpen] = useState(false);
  const [holdName, setHoldName] = useState('');
  const [done, setDone] = useState<{ id: number; invoice_no: string; change_amount: number; total: number; paid: number; due: number } | null>(null);
  const [heldSourceId, setHeldSourceId] = useState<number | null>(restoreId ?? null);
  const barcodeRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const tenderRef = useRef<HTMLInputElement>(null);
  const debouncedSearch = useDebouncedValue(search, 200);

  useEffect(() => {
    (async () => {
      try {
        const [accts, custs] = await Promise.all([
          call<FinancialAccount[]>('account.list'),
          call<Paged<Customer>>('customer.list', { opts: { page: 1, pageSize: 500, status: 'active' } }),
        ]);
        setAccounts(accts);
        setCustomers(custs.rows);
        const cash = accts.find((a) => a.code === 'CASH');
        if (cash) setPayAccountId(cash.id);
      } catch (e) { fail(e); }
    })();
  }, [fail]);

  // Restore held sale if requested via event
  useEffect(() => {
    const id = (window as unknown as { __restoreHeld?: number }).__restoreHeld;
    if (id) {
      (window as unknown as { __restoreHeld?: number }).__restoreHeld = undefined;
      (async () => {
        try {
          const d = await call<{ sale: Sale & { customer_id: number | null; discount: number }; items: (Record<string, unknown> & { product_id: number; qty_milli: number; unit_price: number; discount: number })[] }>('sale.detail', { id });
          const lines: CartLine[] = [];
          for (const it of d.items) {
            try {
              const p = await call<Product>('product.get', { id: it.product_id });
              lines.push({ key: `${p.id}-${Date.now()}-${Math.random()}`, product: p, qty: fromMilli(it.qty_milli), price: it.unit_price, discount: it.discount ?? 0 });
            } catch { /* product missing */ }
          }
          setCart(lines);
          setCustomerId(d.sale.customer_id ?? null);
          setInvDiscount(d.sale.discount ? String(d.sale.discount / 100) : '');
          setHeldSourceId(id);
          notify('success', `হোল্ড করা বিক্রয় ${d.sale.invoice_no} পুনরুদ্ধার করা হয়েছে।`);
        } catch (e) { fail(e); }
      })();
    }
  }, [fail, notify]);

  useEffect(() => {
    if (!debouncedSearch.trim()) { setResults([]); return; }
    (async () => {
      try {
        const r = await call<Product[]>('product.search', { q: debouncedSearch.trim() });
        setResults(r);
        setShowResults(true);
        setHighlight(0);
      } catch { /* noop */ }
    })();
  }, [debouncedSearch]);

  const addProduct = useCallback((p: Product, qty = 1) => {
    setCart((prev) => {
      const found = prev.find((l) => l.product.id === p.id && l.price === p.selling_price);
      if (found) return prev.map((l) => (l.key === found.key ? { ...l, qty: l.qty + qty } : l));
      return [...prev, { key: `${p.id}-${Date.now()}-${Math.random()}`, product: p, qty, price: p.selling_price, discount: 0 }];
    });
    setSearch('');
    setResults([]);
    setShowResults(false);
    barcodeRef.current?.focus();
  }, []);

  const scanBarcode = useCallback(async (code: string) => {
    const c = code.trim();
    if (!c) return;
    try {
      const p = await call<Product>('product.barcode', { code: c });
      addProduct(p);
      notify('success', `“${p.name}” কার্টে যোগ হয়েছে।`);
    } catch (e) { fail(e); }
    finally { setBarcode(''); }
  }, [addProduct, fail, notify]);

  // F8 = payment focus, F9 = hold, F10 = complete
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'F8') { e.preventDefault(); tenderRef.current?.focus(); tenderRef.current?.select(); }
      else if (e.key === 'F9') { e.preventDefault(); if (cart.length) setHoldOpen(true); }
      else if (e.key === 'F10') { e.preventDefault(); void doComplete(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cart]);

  const totals = useMemo(() => {
    let subtotal = 0;
    for (const l of cart) subtotal += Math.round((l.price * l.qty * 1000) / 1000) - l.discount;
    let invDisc = 0;
    try {
      if (invDiscount.trim()) {
        const t = invDiscount.trim();
        invDisc = t.endsWith('%') ? Math.round((subtotal * parseFloat(t)) / 100) : Math.round(parseFloat(t) * 100);
        if (!Number.isFinite(invDisc) || invDisc < 0) invDisc = 0;
        invDisc = Math.min(invDisc, subtotal);
      }
    } catch { invDisc = 0; }
    const total = subtotal - invDisc;
    const paidSoFar = payments.reduce((a, p) => a + p.amount, 0);
    const tender = tendered.trim() ? Math.round(parseFloat(tendered) * 100) || 0 : 0;
    return { subtotal, invDisc, total, paidSoFar, tender, remaining: Math.max(0, total - paidSoFar) };
  }, [cart, invDiscount, payments, tendered]);

  const addPayment = (): void => {
    if (!payAccountId) { notify('error', 'পেমেন্ট হিসাব নির্বাচন করুন।'); return; }
    const amt = totals.tender;
    if (amt <= 0) { notify('error', 'সঠিক টাকার পরিমাণ দিন।'); return; }
    setPayments((p) => [...p, { account_id: payAccountId, method: payMethod, amount: amt }]);
    setTendered('');
  };

  const doComplete = async (): Promise<void> => {
    if (!cart.length) { notify('error', 'কার্টে কোনো পণ্য নেই।'); return; }
    // Auto-add tendered as payment if user typed but didn't add
    let pays = payments;
    if (totals.tender > 0 && payAccountId) {
      pays = [...payments, { account_id: payAccountId, method: payMethod, amount: totals.tender }];
    }
    setBusy(true);
    try {
      const input = {
        items: cart.map((l) => ({ product_id: l.product.id, qty_milli: toMilli(l.qty), unit_price: l.price, discount: l.discount })),
        customer_id: customerId,
        invoice_discount: totals.invDisc,
        payments: pays,
        notes: null,
      };
      const res = heldSourceId
        ? await call<{ id: number; invoice_no: string; total: number; paid: number; due: number; change_amount: number }>('sale.completeHeld', { heldId: heldSourceId, input })
        : await call<{ id: number; invoice_no: string; total: number; paid: number; due: number; change_amount: number }>('sale.complete', { input });
      setDone(res);
      setCart([]);
      setPayments([]);
      setTendered('');
      setInvDiscount('');
      setCustomerId(null);
      setHeldSourceId(null);
      notify('success', `বিক্রয় সম্পন্ন: ${res.invoice_no}`);
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  };

  const doHold = async (): Promise<void> => {
    if (!cart.length) return;
    setBusy(true);
    try {
      const res = await call<{ id: number; invoice_no: string }>('sale.hold', {
        input: {
          items: cart.map((l) => ({ product_id: l.product.id, qty_milli: toMilli(l.qty), unit_price: l.price, discount: l.discount })),
          customer_id: customerId, invoice_discount: totals.invDisc, held_name: holdName.trim() || undefined,
        },
      });
      notify('success', `বিক্রয় হোল্ড করা হয়েছে (${res.invoice_no})।`);
      setCart([]); setPayments([]); setTendered(''); setInvDiscount(''); setCustomerId(null); setHoldOpen(false); setHoldName('');
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  };

  const printDone = async (paper: 'A4' | '80mm' | '58mm', mode: 'print' | 'pdf' | 'preview'): Promise<void> => {
    if (!done || !business) return;
    try {
      const d = await call<{ sale: Record<string, unknown>; items: InvoiceItemRow[]; payments: Record<string, unknown>[] }>('sale.detail', { id: done.id });
      const html = saleInvoiceHtml(business, d.sale, d.items, d.payments, paper);
      if (mode === 'preview') await api.preview({ html, title: `ইনভয়েস ${done.invoice_no}` });
      else if (mode === 'pdf') {
        const r = await api.pdf({ html, pageSize: paper === 'A4' ? 'A4' : undefined });
        if (!r.ok) notify('error', 'PDF তৈরি করা যায়নি।');
        else notify('success', `PDF সংরক্ষণ করা হয়েছে।`);
      } else {
        const r = await api.print({ html, silent: false });
        if (!r.ok) notify('error', 'প্রিন্ট করা যায়নি। প্রিন্টার পরীক্ষা করুন অথবা PDF নিন।');
      }
    } catch (e) { fail(e); }
  };

  const due = totals.total - totals.paidSoFar - (totals.tender > 0 ? totals.tender : 0);
  const change = due < 0 && !customerId ? -due : 0;

  return (
    <div>
      <div className="mq-pos">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="mq-card mq-card-pad">
            <div className="mq-form-grid">
              <Field label="বারকোড স্ক্যান">
                <div className="mq-search-wrap">
                  <ScanBarcode />
                  <input
                    ref={barcodeRef} className="mq-input" value={barcode}
                    onChange={(e) => setBarcode(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void scanBarcode(barcode); }}
                    placeholder="স্ক্যান করুন বা বারকোড লিখে Enter চাপুন" autoFocus
                  />
                </div>
              </Field>
              <Field label="পণ্য খুঁজুন">
                <div className="mq-pos-search">
                  <div className="mq-search-wrap">
                    <Search />
                    <input
                      ref={searchRef} className="mq-input" value={search}
                      onChange={(e) => { setSearch(e.target.value); setShowResults(true); }}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(results.length - 1, h + 1)); }
                        else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(0, h - 1)); }
                        else if (e.key === 'Enter' && results[highlight]) addProduct(results[highlight]);
                        else if (e.key === 'Escape') setShowResults(false);
                      }}
                      placeholder="নাম, SKU বা কোড লিখুন"
                    />
                  </div>
                  {showResults && results.length > 0 && (
                    <div className="mq-pos-results">
                      {results.map((p, i) => (
                        <div key={p.id} className={`mq-pos-result${i === highlight ? ' highlight' : ''}`} onClick={() => addProduct(p)}>
                          <div>
                            <div className="nm">{p.name}</div>
                            <div className="meta">{p.barcode || p.sku || ''} • স্টক: {formatQty(p.stock_milli)} {p.unit_name || ''}</div>
                          </div>
                          <div className="pr">{fmt(p.selling_price)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Field>
            </div>
          </div>

          <div className="mq-card">
            <div className="mq-between" style={{ padding: '12px 16px', borderBottom: '1px solid var(--mq-border)' }}>
              <strong>কার্ট ({cart.length} আইটেম)</strong>
              {cart.length > 0 && <button className="mq-btn sm ghost" onClick={() => setCart([])}><Trash2 /> সব মুছুন</button>}
            </div>
            {cart.length === 0 && <EmptyState icon={<ShoppingCart />} title="কার্ট খালি" sub="বারকোড স্ক্যান করুন বা পণ্য খুঁজে যোগ করুন।" />}
            <div style={{ maxHeight: 380, overflowY: 'auto' }}>
              {cart.map((l) => (
                <div key={l.key} className="mq-cart-item">
                  <div>
                    <div className="nm">{l.product.name}</div>
                    <div className="meta">{fmt(l.price)} / {l.product.unit_name || 'পিস'} • স্টক: {formatQty(l.product.stock_milli)}</div>
                    <div className="mq-flex" style={{ marginTop: 6, gap: 8, flexWrap: 'wrap' }}>
                      <span className="mq-qty">
                        <button onClick={() => setCart((c) => c.map((x) => (x.key === l.key ? { ...x, qty: Math.max(0.001, +(x.qty - 1).toFixed(3)) } : x)))}>-</button>
                        <input value={l.qty} onChange={(e) => { const v = parseFloat(e.target.value) || 0; setCart((c) => c.map((x) => (x.key === l.key ? { ...x, qty: v } : x))); }} />
                        <button onClick={() => setCart((c) => c.map((x) => (x.key === l.key ? { ...x, qty: +(x.qty + 1).toFixed(3) } : x)))}>+</button>
                      </span>
                      {can('sale.price_override') && (
                        <input className="mq-input" style={{ width: 110, height: 30 }} type="number" min={0} value={l.price / 100} title="দাম"
                          onChange={(e) => { const v = Math.round((parseFloat(e.target.value) || 0) * 100); setCart((c) => c.map((x) => (x.key === l.key ? { ...x, price: v } : x))); }} />
                      )}
                      {can('sale.discount') && (
                        <input className="mq-input" style={{ width: 100, height: 30 }} type="number" min={0} value={l.discount ? l.discount / 100 : ''} title="ছাড় (৳)" placeholder="ছাড়"
                          onChange={(e) => { const v = Math.round((parseFloat(e.target.value) || 0) * 100); setCart((c) => c.map((x) => (x.key === l.key ? { ...x, discount: v } : x))); }} />
                      )}
                      <button className="mq-mini-btn danger" onClick={() => setCart((c) => c.filter((x) => x.key !== l.key))} title="মুছুন"><X /></button>
                    </div>
                  </div>
                  <div className="amt">{fmt(Math.round(l.price * l.qty) - l.discount)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mq-card" style={{ position: 'sticky', top: 0 }}>
          <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--mq-border)' }}>
            <Field label="কাস্টমার (বকেয়ার জন্য আবশ্যক)">
              <select className="mq-select" value={customerId ?? ''} onChange={(e) => setCustomerId(e.target.value ? Number(e.target.value) : null)}>
                <option value="">ওয়াক-ইন (সাধারণ)</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` • ${c.phone}` : ''}</option>)}
              </select>
            </Field>
            {can('sale.discount') && (
              <div style={{ marginTop: 10 }}>
                <Field label="ইনভয়েস ছাড় (৳ বা %, যেমন 50 বা 5%)">
                  <input className="mq-input" value={invDiscount} onChange={(e) => setInvDiscount(e.target.value)} placeholder="০" />
                </Field>
              </div>
            )}
          </div>
          <div className="mq-totals">
            <div className="row"><span>উপমোট</span><strong>{fmt(totals.subtotal)}</strong></div>
            <div className="row"><span>ছাড়</span><strong>-{fmt(totals.invDisc)}</strong></div>
            <div className="row grand"><span>সর্বমোট</span><span>{fmt(totals.total)}</span></div>
            <div className="row"><span>পেমেন্ট মাধ্যম</span></div>
            <div className="mq-paygrid">
              {PAY_METHODS.map((m) => (
                <button key={m.id} className={`mq-paybtn${payMethod === m.id ? ' active' : ''}`} onClick={() => {
                  setPayMethod(m.id);
                  const map: Record<string, string> = { cash: 'CASH', bank: 'BANK', bkash: 'BKASH', nagad: 'NAGAD', rocket: 'ROCKET', upay: 'UPAY', card: 'CARD', other: 'OTHER' };
                  const a = accounts.find((x) => x.code === map[m.id]);
                  if (a) setPayAccountId(a.id);
                }}>{m.label}</button>
              ))}
            </div>
            <Field label="হিসাব">
              <select className="mq-select" value={payAccountId ?? ''} onChange={(e) => setPayAccountId(Number(e.target.value))}>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name} ({fmt(a.current_balance ?? 0)})</option>)}
              </select>
            </Field>
            <div className="mq-flex" style={{ gap: 8 }}>
              <div style={{ flex: 1 }}>
                <Field label="প্রাপ্ত টাকা (F8)">
                  <input ref={tenderRef} className="mq-input" inputMode="decimal" value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder={String(totals.remaining / 100)} onKeyDown={(e) => { if (e.key === 'Enter') addPayment(); }} />
                </Field>
              </div>
              <button className="mq-btn" style={{ marginTop: 24 }} onClick={addPayment}><Plus /> যোগ</button>
            </div>
            {payments.length > 0 && (
              <div>
                {payments.map((p, i) => (
                  <div key={i} className="mq-flex" style={{ justifyContent: 'space-between', fontSize: 13 }}>
                    <span>{PAYMENT_METHOD_BN[p.method as PaymentMethod] || p.method}</span>
                    <span><strong>{fmt(p.amount)}</strong> <button className="mq-mini-btn danger" onClick={() => setPayments((x) => x.filter((_, j) => j !== i))}><X /></button></span>
                  </div>
                ))}
              </div>
            )}
            <div className="row"><span>পরিশোধিত</span><strong>{fmt(totals.paidSoFar + (totals.tender > 0 ? totals.tender : 0))}</strong></div>
            {due > 0 && <div className="row"><span>বকেয়া</span><span className="due">{fmt(due)}</span></div>}
            {change > 0 && <div className="row"><span>ফেরত দিন</span><span className="change">{fmt(change)}</span></div>}
          </div>
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="mq-btn success lg block" onClick={doComplete} disabled={busy || !cart.length}>
              <CheckCircle2 /> {busy ? 'প্রক্রিয়াকরণ…' : 'বিক্রয় সম্পন্ন করুন (F10)'}
            </button>
            <div className="mq-btn-row">
              <button className="mq-btn" style={{ flex: 1 }} onClick={() => setHoldOpen(true)} disabled={!cart.length}><Pause /> হোল্ড (F9)</button>
              <button className="mq-btn ghost" style={{ flex: 1 }} onClick={() => { setCart([]); setPayments([]); setTendered(''); }}><Trash2 /> বাতিল</button>
            </div>
          </div>
        </div>
      </div>

      {holdOpen && (
        <Modal title="বিক্রয় হোল্ড করুন" sub="কার্টটি সংরক্ষণ করে পরে সম্পন্ন করা যাবে" onClose={() => setHoldOpen(false)} footer={(
          <>
            <button className="mq-btn" onClick={() => setHoldOpen(false)}>বাতিল</button>
            <button className="mq-btn primary" onClick={doHold} disabled={busy}><Pause /> হোল্ড করুন</button>
          </>
        )}>
          <Field label="হোল্ড নাম (ঐচ্ছিক)" hint="যেমন: টেবিল-৩, কাস্টমারের নাম">
            <input className="mq-input" value={holdName} onChange={(e) => setHoldName(e.target.value)} placeholder="স্বয়ংক্রিয় নাম" autoFocus />
          </Field>
        </Modal>
      )}

      {done && (
        <Modal title="বিক্রয় সম্পন্ন হয়েছে" sub={done.invoice_no} onClose={() => setDone(null)} footer={(
          <>
            <button className="mq-btn" onClick={() => setDone(null)}>বন্ধ করুন</button>
            <button className="mq-btn" onClick={() => printDone(business?.receipt_width === '58mm' ? '58mm' : '80mm', 'preview')}><Eye /> প্রিভিউ</button>
            <button className="mq-btn" onClick={() => printDone('A4', 'pdf')}><FileText /> PDF</button>
            <button className="mq-btn primary" onClick={() => printDone(business?.receipt_width === '58mm' ? '58mm' : '80mm', 'print')}><Printer /> প্রিন্ট</button>
          </>
        )}>
          <div className="mq-totals" style={{ padding: 0 }}>
            <div className="row"><span>মোট</span><strong>{fmt(done.total)}</strong></div>
            <div className="row"><span>পরিশোধ</span><strong>{fmt(done.paid)}</strong></div>
            {done.due > 0 && <div className="row"><span>বকেয়া</span><span className="due">{fmt(done.due)}</span></div>}
            {done.change_amount > 0 && <div className="row"><span>ফেরত দিন</span><span className="change">{fmt(done.change_amount)}</span></div>}
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ================= Invoice list ================= */

function InvoiceList(): React.ReactElement {
  const { business, can, fail, notify } = useApp();
  const { fmt } = useMoney();
  const { range, RangePicker } = useDateRange('thisMonth');
  const [params] = useSearchParams();
  const [q, setQ] = useState('');
  const debouncedQ = useDebouncedValue(q, 300);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<Sale>>({ rows: [], total: 0, page: 1, pageSize: 50 });
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<{ sale: Record<string, unknown> & { id: number; invoice_no: string }; items: InvoiceItemRow[]; payments: Record<string, unknown>[] } | null>(null);
  const [voidTarget, setVoidTarget] = useState<Sale | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [returnTarget, setReturnTarget] = useState<{ sale: Record<string, unknown> & { id: number; invoice_no: string }; items: (InvoiceItemRow & { id: number; qty_milli: number; returned_milli: number; sale_id?: number })[] } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call<Paged<Sale>>('sale.list', { opts: { q: debouncedQ, from: range.fromUtc, to: range.toUtc, payment_status: status || undefined, page, pageSize: 50 } });
      setData(r);
    } catch (e) { fail(e); }
    finally { setLoading(false); }
  }, [debouncedQ, range.fromUtc, range.toUtc, status, page, fail]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [debouncedQ, status, range.fromUtc, range.toUtc]);

  // Deep link: ?invoice=<id>
  useEffect(() => {
    const inv = params.get('invoice');
    if (inv) {
      (async () => {
        try {
          const d = await call<{ sale: Record<string, unknown> & { id: number; invoice_no: string }; items: InvoiceItemRow[]; payments: Record<string, unknown>[] }>('sale.detail', { id: Number(inv) });
          setDetail(d);
        } catch (e) { fail(e); }
      })();
    }
  }, [params, fail]);

  const openDetail = async (id: number): Promise<void> => {
    try {
      const d = await call<{ sale: Record<string, unknown> & { id: number; invoice_no: string }; items: InvoiceItemRow[]; payments: Record<string, unknown>[] }>('sale.detail', { id });
      setDetail(d);
    } catch (e) { fail(e); }
  };

  const printDetail = async (paper: 'A4' | '80mm' | '58mm', mode: 'print' | 'pdf' | 'preview'): Promise<void> => {
    if (!detail || !business) return;
    const html = saleInvoiceHtml(business, detail.sale, detail.items, detail.payments, paper);
    if (mode === 'preview') await api.preview({ html, title: `ইনভয়েস ${detail.sale.invoice_no}` });
    else if (mode === 'pdf') {
      const r = await api.pdf({ html, pageSize: paper === 'A4' ? 'A4' : undefined });
      notify(r.ok ? 'success' : 'error', r.ok ? 'PDF সংরক্ষণ করা হয়েছে।' : 'PDF তৈরি করা যায়নি।');
    } else {
      const r = await api.print({ html, silent: false });
      if (!r.ok) notify('error', 'প্রিন্ট করা যায়নি। প্রিন্টার পরীক্ষা করুন অথবা PDF নিন।');
    }
  };

  const doVoid = async (): Promise<void> => {
    if (!voidTarget || !voidReason.trim()) { notify('error', 'বাতিলের কারণ লিখুন।'); return; }
    setBusy(true);
    try {
      await call('sale.void', { id: voidTarget.id, reason: voidReason.trim() });
      notify('success', 'ইনভয়েস বাতিল করা হয়েছে। স্টক ও হিসাব সমন্বয় করা হয়েছে।');
      setVoidTarget(null); setVoidReason(''); setDetail(null); load();
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <PageHeader title="ইনভয়েস তালিকা" sub={`${range.from} → ${range.to}`}>
        <RangePicker />
      </PageHeader>
      <div className="mq-toolbar">
        <div className="grow mq-search-wrap"><Search /><input className="mq-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="ইনভয়েস, কাস্টমার বা মোবাইল খুঁজুন" /></div>
        <select className="mq-select" style={{ width: 170 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">সব অবস্থা</option>
          <option value="PAID">পরিশোধিত</option>
          <option value="PARTIAL">আংশিক</option>
          <option value="DUE">বকেয়া</option>
        </select>
      </div>
      {loading ? <Spinner /> : data.rows.length === 0 ? (
        <div className="mq-card"><EmptyState icon={<ListOrdered />} title="এখনও কোনো বিক্রয় রেকর্ড নেই" sub="নতুন বিক্রয় শুরু করুন।" /></div>
      ) : (
        <div className="mq-table-wrap">
          <table className="mq-table">
            <thead><tr><th>ইনভয়েস</th><th>তারিখ</th><th>কাস্টমার</th><th>বিক্রেতা</th><th className="num">মোট</th><th className="num">পরিশোধ</th><th className="num">বকেয়া</th><th>অবস্থা</th><th className="center">কার্যক্রম</th></tr></thead>
            <tbody>
              {data.rows.map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.invoice_no}</strong></td>
                  <td>{new Date(s.sold_at).toLocaleString('bn-BD')}</td>
                  <td>{s.customer_name || 'ওয়াক-ইন'}</td>
                  <td>{s.employee_name || '—'}</td>
                  <td className="num">{fmt(s.total)}</td>
                  <td className="num">{fmt(s.paid)}</td>
                  <td className="num">{fmt(s.due)}</td>
                  <td>{paymentBadge(s.payment_status)}</td>
                  <td><div className="mq-row-actions">
                    <button className="mq-mini-btn" title="বিস্তারিত" onClick={() => openDetail(s.id)}><Eye /></button>
                    {can('sale.return') && <button className="mq-mini-btn" title="ফেরত" onClick={async () => {
                      const d = await call<{ sale: Record<string, unknown> & { id: number; invoice_no: string }; items: (InvoiceItemRow & { id: number; qty_milli: number; returned_milli: number })[] }>('sale.detail', { id: s.id });
                      setReturnTarget(d as never);
                    }}><RotateCcw /></button>}
                    {can('sale.void') && <button className="mq-mini-btn danger" title="বাতিল" onClick={() => setVoidTarget(s)}><Ban /></button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />

      {detail && (
        <Modal title={`ইনভয়েস ${detail.sale.invoice_no}`} sub={new Date(String(detail.sale.sold_at)).toLocaleString('bn-BD')} onClose={() => setDetail(null)} size="lg" footer={(
          <>
            <button className="mq-btn" onClick={() => printDetail('A4', 'preview')}><Eye /> প্রিভিউ</button>
            <button className="mq-btn" onClick={() => printDetail('A4', 'pdf')}><FileText /> PDF</button>
            <button className="mq-btn" onClick={() => printDetail('A4', 'print')}><Printer /> A4 প্রিন্ট</button>
            <button className="mq-btn primary" onClick={() => printDetail(business?.receipt_width === '58mm' ? '58mm' : '80mm', 'print')}><Printer /> রসিদ প্রিন্ট</button>
          </>
        )}>
          <div className="mq-flex mq-wrap" style={{ gap: 16, marginBottom: 12 }}>
            <span>কাস্টমার: <strong>{String(detail.sale.customer_name || 'ওয়াক-ইন')}</strong></span>
            <span>{paymentBadge(String(detail.sale.payment_status))}</span>
          </div>
          <div className="mq-table-wrap">
            <table className="mq-table">
              <thead><tr><th>পণ্য</th><th className="num">পরিমাণ</th><th className="num">দর</th><th className="num">ছাড়</th><th className="num">মোট</th></tr></thead>
              <tbody>
                {detail.items.map((it, i) => (
                  <tr key={i}><td>{it.product_name}</td><td className="num">{formatQty(it.qty_milli)}</td><td className="num">{fmt(it.unit_price)}</td><td className="num">{fmt(it.discount)}</td><td className="num">{fmt(it.line_total)}</td></tr>
                ))}
              </tbody>
              <tfoot>
                <tr><td colSpan={4}>উপমোট</td><td className="num">{fmt(Number(detail.sale.subtotal))}</td></tr>
                <tr><td colSpan={4}>ছাড়</td><td className="num">{fmt(Number(detail.sale.discount))}</td></tr>
                <tr><td colSpan={4}>ভ্যাট</td><td className="num">{fmt(Number(detail.sale.tax))}</td></tr>
                <tr><td colSpan={4}>সর্বমোট</td><td className="num">{fmt(Number(detail.sale.total))}</td></tr>
                <tr><td colSpan={4}>পরিশোধ</td><td className="num">{fmt(Number(detail.sale.paid))}</td></tr>
                <tr><td colSpan={4}>বকেয়া</td><td className="num">{fmt(Number(detail.sale.due))}</td></tr>
              </tfoot>
            </table>
          </div>
        </Modal>
      )}

      {voidTarget && (
        <Modal title="ইনভয়েস বাতিল করুন" sub={voidTarget.invoice_no} onClose={() => { setVoidTarget(null); setVoidReason(''); }} footer={(
          <>
            <button className="mq-btn" onClick={() => { setVoidTarget(null); setVoidReason(''); }}>ফিরে যান</button>
            <button className="mq-btn danger" onClick={doVoid} disabled={busy || !voidReason.trim()}>{busy ? 'প্রক্রিয়াকরণ…' : 'বাতিল নিশ্চিত করুন'}</button>
          </>
        )}>
          <p style={{ marginTop: 0 }}>এই ইনভয়েসটি বাতিল করলে এর বিক্রয়, স্টক এবং সংশ্লিষ্ট হিসাব সমন্বয় করা হবে। আপনি কি চালিয়ে যেতে চান?</p>
          <ul style={{ paddingLeft: 20, color: 'var(--mq-text-2)', fontSize: 13 }}>
            <li>পণ্যের স্টক ফেরত আসবে</li>
            <li>পেমেন্টের টাকা হিসাব থেকে সমন্বয় হবে</li>
            <li>কাস্টমারের বকেয়া সমন্বয় হবে</li>
            <li>এই কাজটি অডিট লগে রেকর্ড থাকবে</li>
          </ul>
          <Field label="বাতিলের কারণ" required>
            <input className="mq-input" value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="যেমন: ভুল এন্ট্রি" autoFocus />
          </Field>
        </Modal>
      )}

      {returnTarget && <SaleReturnModal key={returnTarget.sale.id} data={returnTarget} onClose={() => setReturnTarget(null)} onDone={() => { setReturnTarget(null); load(); }} />}
    </div>
  );
}

export function SaleReturnModal({ data, onClose, onDone }: {
  data: { sale: Record<string, unknown> & { id: number; invoice_no: string }; items: (InvoiceItemRow & { id: number; qty_milli: number; returned_milli: number })[] };
  onClose: () => void; onDone: () => void;
}): React.ReactElement {
  const { fail, notify } = useApp();
  const { fmt } = useMoney();
  const [qtys, setQtys] = useState<Record<number, string>>({});
  const [accounts, setAccounts] = useState<FinancialAccount[]>([]);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const a = await call<FinancialAccount[]>('account.list');
        setAccounts(a);
        const cash = a.find((x) => x.code === 'CASH');
        if (cash) setAccountId(cash.id);
      } catch (e) { fail(e); }
    })();
  }, [fail]);

  const submit = async (): Promise<void> => {
    const items = data.items
      .map((it) => ({ sale_item_id: it.id, qty_milli: qtys[it.id] ? toMilli(parseFloat(qtys[it.id]) || 0) : 0 }))
      .filter((x) => x.qty_milli > 0);
    if (!items.length) { notify('error', 'কমপক্ষে একটি পণ্যের ফেরত পরিমাণ দিন।'); return; }
    if (!accountId) { notify('error', 'ফেরতের হিসাব নির্বাচন করুন।'); return; }
    setBusy(true);
    try {
      const r = await call<{ reference: string; total_refund: number }>('sale.return', { input: { sale_id: data.sale.id, items, account_id: accountId, reason: reason.trim() || undefined } });
      notify('success', `ফেরত সম্পন্ন: ${r.reference} (${fmt(r.total_refund)})`);
      onDone();
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={`বিক্রয় ফেরত — ${data.sale.invoice_no}`} sub="যে পরিমাণ ফেরত নিচ্ছেন তা লিখুন" onClose={onClose} size="lg" footer={(
      <>
        <button className="mq-btn" onClick={onClose}>বাতিল করুন</button>
        <button className="mq-btn primary" onClick={submit} disabled={busy}>{busy ? 'প্রক্রিয়াকরণ…' : 'ফেরত নিশ্চিত করুন'}</button>
      </>
    )}>
      <div className="mq-table-wrap">
        <table className="mq-table">
          <thead><tr><th>পণ্য</th><th className="num">বিক্রীত</th><th className="num">পূর্বে ফেরত</th><th className="num">ফেরতযোগ্য</th><th>ফেরত পরিমাণ</th></tr></thead>
          <tbody>
            {data.items.map((it) => {
              const avail = it.qty_milli - (it.returned_milli ?? 0);
              return (
                <tr key={it.id}>
                  <td>{it.product_name}</td>
                  <td className="num">{formatQty(it.qty_milli)}</td>
                  <td className="num">{formatQty(it.returned_milli ?? 0)}</td>
                  <td className="num">{formatQty(avail)}</td>
                  <td><input className="mq-input" style={{ width: 110 }} inputMode="decimal" value={qtys[it.id] || ''} onChange={(e) => setQtys({ ...qtys, [it.id]: e.target.value })} placeholder="০" disabled={avail <= 0} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="mq-form-grid mq-mt">
        <Field label="ফেরতের হিসাব (টাকা যাবে)" required>
          <select className="mq-select" value={accountId ?? ''} onChange={(e) => setAccountId(Number(e.target.value))}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="ফেরতের কারণ"><input className="mq-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="যেমন: ত্রুটিপূর্ণ পণ্য" /></Field>
      </div>
    </Modal>
  );
}

/* ================= Held list ================= */

function HeldList({ onRestore }: { onRestore: () => void }): React.ReactElement {
  const { fail, notify } = useApp();
  const { fmt } = useMoney();
  const [rows, setRows] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call<Sale[]>('sale.heldList');
      setRows(r);
    } catch (e) { fail(e); }
    finally { setLoading(false); }
  }, [fail]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <PageHeader title="হোল্ড করা বিক্রয়" sub={`${rows.length}টি অপেক্ষমাণ`} />
      {loading ? <Spinner /> : rows.length === 0 ? (
        <div className="mq-card"><EmptyState icon={<Pause />} title="কোনো হোল্ড করা বিক্রয় নেই" /></div>
      ) : (
        <div className="mq-table-wrap">
          <table className="mq-table">
            <thead><tr><th>রেফারেন্স</th><th>নাম</th><th>কাস্টমার</th><th>সময়</th><th className="num">মোট</th><th className="center">কার্যক্রম</th></tr></thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id}>
                  <td><strong>{s.invoice_no}</strong></td>
                  <td>{s.held_name || '—'}</td>
                  <td>{s.customer_name || 'ওয়াক-ইন'}</td>
                  <td>{new Date(s.sold_at).toLocaleString('bn-BD')}</td>
                  <td className="num">{fmt(s.total)}</td>
                  <td><div className="mq-row-actions">
                    <button className="mq-btn sm primary" onClick={() => { (window as unknown as { __restoreHeld?: number }).__restoreHeld = s.id; onRestore(); }}><Play /> পুনরুদ্ধার</button>
                    <button className="mq-btn sm" onClick={async () => {
                      if (!window.confirm('এই হোল্ড করা বিক্রয়টি মুছে ফেলবেন?')) return;
                      try { await call('sale.heldCancel', { id: s.id }); notify('success', 'হোল্ড বাতিল করা হয়েছে।'); load(); } catch (e) { fail(e); }
                    }}><Trash2 /> মুছুন</button>
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ================= Return list ================= */

function ReturnList(): React.ReactElement {
  const { fail } = useApp();
  const { fmt } = useMoney();
  const { range, RangePicker } = useDateRange('thisMonth');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<Record<string, unknown>>>({ rows: [], total: 0, page: 1, pageSize: 50 });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call<Paged<Record<string, unknown>>>('sale.returnList', { opts: { from: range.fromUtc, to: range.toUtc, page, pageSize: 50 } });
      setData(r);
    } catch (e) { fail(e); }
    finally { setLoading(false); }
  }, [range.fromUtc, range.toUtc, page, fail]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <PageHeader title="বিক্রয় ফেরত" sub={`${range.from} → ${range.to}`}>
        <RangePicker />
      </PageHeader>
      {loading ? <Spinner /> : data.rows.length === 0 ? (
        <div className="mq-card"><EmptyState icon={<Undo2 />} title="কোনো ফেরত রেকর্ড নেই" /></div>
      ) : (
        <div className="mq-table-wrap">
          <table className="mq-table">
            <thead><tr><th>রেফারেন্স</th><th>ইনভয়েস</th><th>কাস্টমার</th><th>তারিখ</th><th>হিসাব</th><th className="num">ফেরত টাকা</th><th>কারণ</th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={String(r.id)}>
                  <td><strong>{String(r.reference)}</strong></td>
                  <td>{String(r.invoice_no)}</td>
                  <td>{String(r.customer_name || 'ওয়াক-ইন')}</td>
                  <td>{new Date(String(r.returned_at)).toLocaleString('bn-BD')}</td>
                  <td>{String(r.account_name || '—')}</td>
                  <td className="num">{fmt(Number(r.total_refund))}</td>
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

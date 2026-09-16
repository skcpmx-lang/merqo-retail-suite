import React, { useCallback, useEffect, useState } from 'react';
import { BarChart3, Printer, FileText, FileSpreadsheet, Eye } from 'lucide-react';
import { Layout } from '../components/Layout';
import { PageHeader, EmptyState, Pagination, Spinner } from '../components/ui';
import { useDateRange } from '../components/DateRange';
import { call, api } from '../api';
import { useApp, useMoney } from '../store';
import { formatQty } from '@shared/qty';
import { formatMoney } from '@shared/money';
import { PAYMENT_METHOD_BN } from '@shared/constants';
import type { Paged } from '@shared/types';
import { reportPrintHtml } from '../components/PrintDocs';

interface ReportDef {
  id: string;
  group: string;
  label: string;
  perm: string;
  needsRange: boolean;
  columns: { key: string; label: string; num?: boolean; money?: boolean; qty?: boolean }[];
}

const REPORTS: ReportDef[] = [
  { id: 'salesSummary', group: 'বিক্রয়', label: 'দৈনিক বিক্রয় সারসংক্ষেপ', perm: 'report.sales', needsRange: true, columns: [
    { key: 'day', label: 'তারিখ' }, { key: 'invoices', label: 'ইনভয়েস', num: true }, { key: 'subtotal', label: 'উপমোট', money: true },
    { key: 'discount', label: 'ছাড়', money: true }, { key: 'tax', label: 'ভ্যাট', money: true }, { key: 'total', label: 'মোট', money: true },
    { key: 'paid', label: 'পরিশোধ', money: true }, { key: 'due', label: 'বকেয়া', money: true }] },
  { id: 'salesByProduct', group: 'বিক্রয়', label: 'পণ্য অনুযায়ী বিক্রয়', perm: 'report.sales', needsRange: true, columns: [
    { key: 'name', label: 'পণ্য' }, { key: 'qty_milli', label: 'পরিমাণ', qty: true }, { key: 'revenue', label: 'রেভিনিউ', money: true }, { key: 'cogs', label: 'ক্রয়মূল্য', money: true }] },
  { id: 'salesByCategory', group: 'বিক্রয়', label: 'ক্যাটাগরি অনুযায়ী বিক্রয়', perm: 'report.sales', needsRange: true, columns: [
    { key: 'category', label: 'ক্যাটাগরি' }, { key: 'qty_milli', label: 'পরিমাণ', qty: true }, { key: 'revenue', label: 'রেভিনিউ', money: true }] },
  { id: 'salesByEmployee', group: 'বিক্রয়', label: 'কর্মচারী অনুযায়ী বিক্রয়', perm: 'report.sales', needsRange: true, columns: [
    { key: 'employee', label: 'কর্মচারী' }, { key: 'invoices', label: 'ইনভয়েস', num: true }, { key: 'total', label: 'মোট', money: true }] },
  { id: 'salesByPayment', group: 'বিক্রয়', label: 'পেমেন্ট মাধ্যম অনুযায়ী', perm: 'report.sales', needsRange: true, columns: [
    { key: 'method', label: 'মাধ্যম' }, { key: 'count', label: 'সংখ্যা', num: true }, { key: 'total', label: 'মোট', money: true }] },
  { id: 'dueSales', group: 'বিক্রয়', label: 'বকেয়া বিক্রয়', perm: 'report.sales', needsRange: false, columns: [
    { key: 'invoice_no', label: 'ইনভয়েস' }, { key: 'sold_at', label: 'তারিখ' }, { key: 'customer_name', label: 'কাস্টমার' },
    { key: 'total', label: 'মোট', money: true }, { key: 'paid', label: 'পরিশোধ', money: true }, { key: 'due', label: 'বকেয়া', money: true }] },
  { id: 'purchaseSummary', group: 'ক্রয়', label: 'ক্রয় সারসংক্ষেপ', perm: 'report.purchase', needsRange: true, columns: [
    { key: 'day', label: 'তারিখ' }, { key: 'count', label: 'সংখ্যা', num: true }, { key: 'total', label: 'মোট', money: true },
    { key: 'paid', label: 'পরিশোধ', money: true }, { key: 'due', label: 'বকেয়া', money: true }] },
  { id: 'purchaseBySupplier', group: 'ক্রয়', label: 'সরবরাহকারী অনুযায়ী ক্রয়', perm: 'report.purchase', needsRange: true, columns: [
    { key: 'supplier', label: 'সরবরাহকারী' }, { key: 'count', label: 'সংখ্যা', num: true }, { key: 'total', label: 'মোট', money: true },
    { key: 'paid', label: 'পরিশোধ', money: true }, { key: 'due', label: 'বকেয়া', money: true }] },
  { id: 'purchaseByProduct', group: 'ক্রয়', label: 'পণ্য অনুযায়ী ক্রয়', perm: 'report.purchase', needsRange: true, columns: [
    { key: 'name', label: 'পণ্য' }, { key: 'qty_milli', label: 'পরিমাণ', qty: true }, { key: 'total', label: 'মোট', money: true }] },
  { id: 'stockCurrent', group: 'স্টক', label: 'বর্তমান স্টক', perm: 'report.inventory', needsRange: false, columns: [
    { key: 'name', label: 'পণ্য' }, { key: 'category_name', label: 'ক্যাটাগরি' }, { key: 'stock_milli', label: 'স্টক', qty: true },
    { key: 'purchase_price', label: 'ক্রয়মূল্য', money: true }, { key: 'selling_price', label: 'বিক্রয়মূল্য', money: true }, { key: 'stock_value', label: 'স্টক মূল্য', money: true }] },
  { id: 'expiry', group: 'স্টক', label: 'মেয়াদ-ঝুঁকি (৩০ দিন)', perm: 'report.inventory', needsRange: false, columns: [
    { key: 'product_name', label: 'পণ্য' }, { key: 'batch_no', label: 'ব্যাচ' }, { key: 'expiry_date', label: 'মেয়াদ' }, { key: 'qty_milli', label: 'পরিমাণ', qty: true }] },
  { id: 'slowStock', group: 'স্টক', label: 'স্লো/ডেড স্টক (৯০ দিন)', perm: 'report.inventory', needsRange: false, columns: [
    { key: 'name', label: 'পণ্য' }, { key: 'stock_milli', label: 'স্টক', qty: true }, { key: 'last_sold', label: 'শেষ বিক্রয়' }] },
  { id: 'cashflow', group: 'আর্থিক', label: 'ক্যাশ ফ্লো', perm: 'report.financial', needsRange: true, columns: [
    { key: 'day', label: 'তারিখ' }, { key: 'inflow', label: 'জমা', money: true }, { key: 'outflow', label: 'খরচ', money: true }] },
  { id: 'accountBalances', group: 'আর্থিক', label: 'হিসাব ব্যালেন্স', perm: 'report.financial', needsRange: false, columns: [
    { key: 'name', label: 'হিসাব' }, { key: 'opening_balance', label: 'প্রারম্ভিক', money: true }, { key: 'balance', label: 'বর্তমান', money: true }] },
  { id: 'receivables', group: 'আর্থিক', label: 'পাওনা (কাস্টমার বকেয়া)', perm: 'report.financial', needsRange: false, columns: [
    { key: 'name', label: 'কাস্টমার' }, { key: 'phone', label: 'মোবাইল' }, { key: 'due', label: 'বকেয়া', money: true }, { key: 'last_txn', label: 'শেষ লেনদেন' }] },
  { id: 'payables', group: 'আর্থিক', label: 'দেনা (সরবরাহকারী)', perm: 'report.financial', needsRange: false, columns: [
    { key: 'name', label: 'সরবরাহকারী' }, { key: 'phone', label: 'মোবাইল' }, { key: 'payable', label: 'দেনা', money: true }, { key: 'last_txn', label: 'শেষ লেনদেন' }] },
];

export function Reports(): React.ReactElement {
  const { business, can, fail, notify } = useApp();
  const { fmt } = useMoney();
  const { range, RangePicker } = useDateRange('thisMonth');
  const [reportId, setReportId] = useState('salesSummary');
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<Record<string, unknown> | null>(null);

  const def = REPORTS.find((r) => r.id === reportId)!;
  const visible = REPORTS.filter((r) => can(r.perm));
  const groups = [...new Set(visible.map((r) => r.group))];

  const load = useCallback(async () => {
    setLoading(true);
    setSummary(null);
    try {
      const f = { from: range.fromUtc, to: range.toUtc };
      let res: Record<string, unknown>[] = [];
      let tot = 0;
      switch (reportId) {
        case 'salesSummary': res = await call<Record<string, unknown>[]>('report.salesSummary', { f }); break;
        case 'salesByProduct': { const r = await call<Paged<Record<string, unknown>>>('report.salesByProduct', { f: { ...f, page, pageSize: 100 } }); res = r.rows; tot = r.total; break; }
        case 'salesByCategory': res = await call<Record<string, unknown>[]>('report.salesByCategory', { f }); break;
        case 'salesByEmployee': res = await call<Record<string, unknown>[]>('report.salesByEmployee', { f }); break;
        case 'salesByPayment': res = await call<Record<string, unknown>[]>('report.salesByPayment', { f }); break;
        case 'dueSales': { const r = await call<Paged<Record<string, unknown>>>('report.dueSales', { f: { page, pageSize: 100 } }); res = r.rows; tot = r.total; break; }
        case 'purchaseSummary': res = await call<Record<string, unknown>[]>('report.purchaseSummary', { f }); break;
        case 'purchaseBySupplier': res = await call<Record<string, unknown>[]>('report.purchaseBySupplier', { f }); break;
        case 'purchaseByProduct': { const r = await call<Paged<Record<string, unknown>>>('report.purchaseByProduct', { f: { ...f, page, pageSize: 100 } }); res = r.rows; tot = r.total; break; }
        case 'stockCurrent': { const r = await call<Paged<Record<string, unknown>>>('report.stockCurrent', { f: { page, pageSize: 100 } }); res = r.rows; tot = r.total; break; }
        case 'expiry': res = await call<Record<string, unknown>[]>('report.expiry', { days: 30 }); break;
        case 'slowStock': res = await call<Record<string, unknown>[]>('report.slowStock', { days: 90 }); break;
        case 'cashflow': { const r = await call<{ daily: Record<string, unknown>[] }>('report.cashflow', { f }); res = r.daily; break; }
        case 'accountBalances': res = await call<Record<string, unknown>[]>('report.accountBalances'); break;
        case 'receivables': { const r = await call<Paged<Record<string, unknown>>>('report.receivables', { f: { page, pageSize: 100 } }); res = r.rows; tot = r.total; break; }
        case 'payables': { const r = await call<Paged<Record<string, unknown>>>('report.payables', { f: { page, pageSize: 100 } }); res = r.rows; tot = r.total; break; }
        case 'incomeExpense': case 'profit': {
          const r = await call<Record<string, unknown>>('report.profit', { f });
          setSummary(r);
          res = ((r.byProduct as Record<string, unknown>[]) || []).map((p) => ({ ...p, profit: Number(p.revenue) - Number(p.cogs) }));
          break;
        }
      }
      setRows(res);
      setTotal(tot || res.length);
    } catch (e) { fail(e); }
    finally { setLoading(false); }
  }, [reportId, range.fromUtc, range.toUtc, page, fail]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [reportId, range.fromUtc, range.toUtc]);

  const cell = (r: Record<string, unknown>, key: string, col: { money?: boolean; qty?: boolean }): string => {
    const v = r[key];
    if (v === null || v === undefined || v === '') return '—';
    if (col.money) return fmt(Number(v));
    if (col.qty) return formatQty(Number(v));
    if (key === 'method') return PAYMENT_METHOD_BN[String(v) as keyof typeof PAYMENT_METHOD_BN] || String(v);
    if ((key === 'sold_at' || key === 'last_txn' || key === 'last_sold') && typeof v === 'string' && v.includes('T')) return new Date(v).toLocaleString('bn-BD');
    return String(v);
  };

  const activeCols = (reportId === 'profit' || reportId === 'incomeExpense')
    ? [{ key: 'name', label: 'পণ্য' }, { key: 'revenue', label: 'রেভিনিউ', money: true }, { key: 'cogs', label: 'ক্রয়মূল্য', money: true }, { key: 'profit', label: 'লাভ', money: true }]
    : def.columns;

  const doPrint = async (mode: 'print' | 'pdf' | 'preview'): Promise<void> => {
    if (!business) return;
    const moneyOf = (v: unknown): number => (typeof v === 'number' ? v : 0);
    const footer = summary
      ? `<strong>নিট রেভিনিউ:</strong> ${formatMoney(moneyOf((summary.summary as Record<string, unknown>)?.revenue))} •
         <strong>মোট লাভ:</strong> ${formatMoney(moneyOf((summary.summary as Record<string, unknown>)?.gross))} •
         <strong>খরচ:</strong> ${formatMoney(moneyOf((summary.summary as Record<string, unknown>)?.expenses))} •
         <strong>নিট লাভ:</strong> ${formatMoney(moneyOf((summary.summary as Record<string, unknown>)?.net))}`
      : undefined;
    const html = reportPrintHtml(business, def.label, `সময়: ${def.needsRange ? `${range.from} → ${range.to}` : 'সব'} • সারি: ${rows.length}`,
      activeCols.map((c) => c.label),
      rows.map((r) => activeCols.map((c) => cell(r, c.key, c))),
      footer);
    if (mode === 'preview') await api.preview({ html, title: def.label });
    else if (mode === 'pdf') {
      const res = await api.pdf({ html, pageSize: 'A4' });
      notify(res.ok ? 'success' : 'error', res.ok ? 'PDF সংরক্ষণ করা হয়েছে।' : 'PDF তৈরি করা যায়নি।');
    } else {
      const res = await api.print({ html, silent: false });
      if (!res.ok) notify('error', 'প্রিন্ট করা যায়নি।');
    }
  };

  const doExcel = async (): Promise<void> => {
    if (!can('report.export')) { notify('error', 'এক্সপোর্টের অনুমতি আপনার নেই।'); return; }
    try {
      const res = await call<{ file: string }>('export.excel', {
        kind: reportId, title: def.label, headers: activeCols.map((c) => c.label),
        rows: rows.map((r) => activeCols.map((c) => {
          const v = r[c.key];
          if (c.money && typeof v === 'number') return v / 100;
          if (c.qty && typeof v === 'number') return v / 1000;
          return (v as string | number) ?? '';
        })),
      });
      notify('success', 'এক্সেল ফাইল তৈরি হয়েছে।');
      await api.shell('showItem', res.file);
    } catch (e) { fail(e); }
  };

  return (
    <Layout title="রিপোর্ট" sub="বিক্রয়, ক্রয়, স্টক, আর্থিক ও লাভ">
      <div className="mq-settings">
        <div className="mq-settings-nav">
          {groups.map((g) => (
            <div key={g}>
              <p className="mq-small mq-muted" style={{ margin: '8px 12px 4px', fontWeight: 800 }}>{g}</p>
              {visible.filter((r) => r.group === g).map((r) => (
                <button key={r.id} className={reportId === r.id ? 'active' : ''} onClick={() => setReportId(r.id)}>
                  <BarChart3 /> {r.label}
                </button>
              ))}
            </div>
          ))}
          {can('report.profit') && (
            <div>
              <p className="mq-small mq-muted" style={{ margin: '8px 12px 4px', fontWeight: 800 }}>লাভ</p>
              <button className={reportId === 'profit' ? 'active' : ''} onClick={() => setReportId('profit')}><BarChart3 /> লাভ রিপোর্ট</button>
            </div>
          )}
        </div>
        <div>
          <PageHeader title={(reportId === 'profit' ? { label: 'লাভ রিপোর্ট' } : def).label} sub={def.needsRange || reportId === 'profit' ? `${range.from} → ${range.to}` : 'সব সময়'}>
            {(def.needsRange || reportId === 'profit') && <RangePicker />}
          </PageHeader>

          {summary && (
            <div className="mq-grid cols-3" style={{ marginBottom: 14 }}>
              <div className="mq-kpi" style={{ ['--mq-kpi-color' as string]: '#0e63b6' }}><div className="mq-kpi-label">নিট রেভিনিউ</div><div className="mq-kpi-value">{fmt(Number((summary.summary as Record<string, unknown>)?.revenue ?? 0))}</div></div>
              <div className="mq-kpi" style={{ ['--mq-kpi-color' as string]: '#12805c' }}><div className="mq-kpi-label">মোট লাভ</div><div className="mq-kpi-value">{fmt(Number((summary.summary as Record<string, unknown>)?.gross ?? 0))}</div></div>
              <div className="mq-kpi" style={{ ['--mq-kpi-color' as string]: '#5b5bd6' }}><div className="mq-kpi-label">নিট লাভ (খরচ ও কমিশনসহ)</div><div className="mq-kpi-value">{fmt(Number((summary.summary as Record<string, unknown>)?.net ?? 0))}</div></div>
            </div>
          )}

          <div className="mq-btn-row" style={{ marginBottom: 12 }}>
            <button className="mq-btn sm" onClick={() => doPrint('preview')}><Eye /> প্রিভিউ</button>
            <button className="mq-btn sm" onClick={() => doPrint('print')}><Printer /> প্রিন্ট</button>
            <button className="mq-btn sm" onClick={() => doPrint('pdf')}><FileText /> PDF</button>
            {can('report.export') && <button className="mq-btn sm" onClick={doExcel}><FileSpreadsheet /> এক্সেল</button>}
          </div>

          {loading ? <Spinner /> : rows.length === 0 ? (
            <div className="mq-card"><EmptyState icon={<BarChart3 />} title="এই রিপোর্টে কোনো তথ্য নেই" sub="অন্য তারিখ সীমা চেষ্টা করুন।" /></div>
          ) : (
            <div className="mq-table-wrap">
              <table className="mq-table">
                <thead><tr>{activeCols.map((c) => <th key={c.key} className={c.money || c.qty ? 'num' : ''}>{c.label}</th>)}</tr></thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i}>{activeCols.map((c) => <td key={c.key} className={c.money || c.qty ? 'num' : ''}>{cell(r, c.key, c)}</td>)}</tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {total > 100 && <Pagination page={page} pageSize={100} total={total} onChange={setPage} />}
        </div>
      </div>
    </Layout>
  );
}

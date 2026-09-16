import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  TrendingUp, ShoppingBag, PiggyBank, Receipt, HandCoins, Handshake, Wallet, Boxes,
  Plus, ScanBarcode, AlertTriangle, ArrowRight,
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { PageHeader, EmptyState, Spinner, Badge } from '../components/ui';
import { useDateRange } from '../components/DateRange';
import { LineChart, BarChart, DonutChart } from '../components/Charts';
import { call } from '../api';
import { useApp, useMoney } from '../store';
import { rangeToUtcBounds, resolvePreset } from '@shared/dates';
import { PAYMENT_METHOD_BN } from '@shared/constants';
import { formatQty } from '@shared/qty';

interface DashData {
  kpi: { sales: number; purchases: number; profit: number; expenses: number; receivable: number; payable: number; cash: number; stockValue: number };
  salesTrend: { day: string; total: number }[];
  purchaseTrend: { day: string; total: number }[];
  expenseTrend: { day: string; total: number }[];
  cashflow: { day: string; inflow: number; outflow: number }[];
  payMethods: { method: string; total: number }[];
  topProducts: { id: number; name: string; qty_milli: number; revenue: number }[];
  lowStock: { id: number; name: string; stock_milli: number }[];
  outStock: { id: number; name: string }[];
  topReceivables: { id: number; name: string; due: number }[];
  topPayables: { id: number; name: string; payable: number }[];
  counts: { sales_count: number; product_count: number; customer_count: number };
}

export function Dashboard(): React.ReactElement {
  const { business, can } = useApp();
  const { fmt } = useMoney();
  const navigate = useNavigate();
  const { range, RangePicker } = useDateRange('last7');
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);
  const tz = business?.timezone || 'Asia/Dhaka';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const day = resolvePreset('today', tz);
      const dayB = rangeToUtcBounds(day, tz);
      const d = await call<DashData>('report.dashboard', {
        dayFrom: dayB.fromUtc, dayTo: dayB.toUtc, trendFrom: range.fromUtc, trendTo: range.toUtc,
      });
      setData(d);
    } catch { /* handled by caller toast in store? show empty */ }
    finally { setLoading(false); }
  }, [range.fromUtc, range.toUtc, tz]);

  useEffect(() => { load(); }, [load]);

  const k = data?.kpi;
  const kpis = [
    { label: 'আজকের বিক্রয়', value: k ? fmt(k.sales) : '—', sub: 'আজ • ফেরত বাদে নিট', icon: <TrendingUp />, color: '#0e63b6' },
    { label: 'আজকের ক্রয়', value: k ? fmt(k.purchases) : '—', sub: 'আজ', icon: <ShoppingBag />, color: '#5b5bd6' },
    { label: 'আজকের লাভ', value: k ? fmt(k.profit) : '—', sub: 'আজ • মোট লাভ (FIFO)', icon: <PiggyBank />, color: '#12805c' },
    { label: 'আজকের খরচ', value: k ? fmt(k.expenses) : '—', sub: 'আজ', icon: <Receipt />, color: '#c0362c' },
    { label: 'মোট পাওনা', value: k ? fmt(k.receivable) : '—', sub: 'কাস্টমার বকেয়া', icon: <HandCoins />, color: '#9a6200' },
    { label: 'মোট দেনা', value: k ? fmt(k.payable) : '—', sub: 'সরবরাহকারী দেনা', icon: <Handshake />, color: '#0e7490' },
    { label: 'হাতে নগদ', value: k ? fmt(k.cash) : '—', sub: 'ক্যাশ হিসাব', icon: <Wallet />, color: '#12805c' },
    { label: 'মোট স্টক মূল্য', value: k ? fmt(k.stockValue) : '—', sub: 'ক্রয়মূল্যে মূল্যায়ন', icon: <Boxes />, color: '#5b5bd6' },
  ];

  const isFresh = data && data.counts.sales_count === 0 && data.counts.product_count === 0;

  return (
    <Layout title="ড্যাশবোর্ড" sub="ব্যবসার সারসংক্ষেপ">
      <PageHeader title={`আসসালামু আলাইকুম, ${business?.name || ''}`} sub={`ট্রেন্ড সীমা: ${range.from} → ${range.to} • KPI: আজকের দিন`}>
        <RangePicker />
      </PageHeader>

      {loading && <Spinner />}
      {!loading && data && (
        <>
          {isFresh && (
            <div className="mq-alert info" style={{ marginBottom: 14 }}>
              <div>
                <strong>শুরু করুন:</strong> এখনও কোনো পণ্য বা বিক্রয় নেই। প্রথমে পণ্য যোগ করুন, তারপর বিক্রয় শুরু করুন।
                <div className="mq-btn-row" style={{ marginTop: 10 }}>
                  <button className="mq-btn primary sm" onClick={() => navigate('/products?new=1')}><Plus /> নতুন পণ্য যোগ করুন</button>
                  <button className="mq-btn sm" onClick={() => navigate('/sales')}>নতুন বিক্রয় শুরু করুন</button>
                </div>
              </div>
            </div>
          )}

          <div className="mq-grid kpi">
            {kpis.map((x) => (
              <div key={x.label} className="mq-kpi" style={{ ['--mq-kpi-color' as string]: x.color }}>
                <div className="mq-kpi-label">{x.icon} {x.label}</div>
                <div className="mq-kpi-value">{x.value}</div>
                <div className="mq-kpi-sub">{x.sub}</div>
              </div>
            ))}
          </div>

          <div className="mq-card mq-card-pad mq-mt">
            <p className="mq-card-title">দ্রুত কাজ</p>
            <div className="mq-btn-row" style={{ marginTop: 10 }}>
              {can('sale.create') && <button className="mq-btn primary" onClick={() => navigate('/sales')}><Plus /> নতুন বিক্রয়</button>}
              {can('purchase.create') && <button className="mq-btn" onClick={() => navigate('/purchases?new=1')}><Plus /> নতুন ক্রয়</button>}
              {can('product.create') && <button className="mq-btn" onClick={() => navigate('/products?new=1')}><Plus /> নতুন পণ্য</button>}
              {can('customer.payment') && <button className="mq-btn" onClick={() => navigate('/customers?pay=1')}><HandCoins /> কাস্টমার পেমেন্ট</button>}
              {can('supplier.payment') && <button className="mq-btn" onClick={() => navigate('/suppliers?pay=1')}><Handshake /> সরবরাহকারী পেমেন্ট</button>}
              {can('expense.create') && <button className="mq-btn" onClick={() => navigate('/accounts?tab=expenses&new=1')}><Receipt /> খরচ যোগ করুন</button>}
              <button className="mq-btn" onClick={() => navigate('/sales?scan=1')}><ScanBarcode /> বারকোড স্ক্যান</button>
            </div>
          </div>

          {(data.lowStock.length > 0 || data.outStock.length > 0) && (
            <div className="mq-alert warn mq-mt">
              <AlertTriangle />
              <div>
                <strong>স্টক সতর্কতা:</strong> {data.outStock.length > 0 && `${data.outStock.length}টি পণ্যের স্টক শেষ`}
                {data.outStock.length > 0 && data.lowStock.length > 0 && ' • '}
                {data.lowStock.length > 0 && `${data.lowStock.length}টি পণ্যের স্টক কম`}
                <button className="mq-btn sm" style={{ marginLeft: 10 }} onClick={() => navigate('/products?stock=low')}>দেখুন <ArrowRight /></button>
              </div>
            </div>
          )}

          <div className="mq-grid cols-2 mq-mt">
            <div className="mq-card mq-card-pad">
              <p className="mq-card-title">বিক্রয় ট্রেন্ড</p>
              <p className="mq-card-sub">{range.from} → {range.to}</p>
              {data.salesTrend.length ? <LineChart data={data.salesTrend.map((d) => ({ label: d.day, value: d.total }))} formatY={fmt} /> : <EmptyState title="এই সময়ে বিক্রয় নেই" />}
            </div>
            <div className="mq-card mq-card-pad">
              <p className="mq-card-title">ক্রয় বনাম খরচ</p>
              <p className="mq-card-sub">{range.from} → {range.to}</p>
              <BarChart data={data.purchaseTrend.map((d) => ({ label: d.day, value: d.total }))} formatY={fmt} />
              <div className="mq-chart-legend"><span><i style={{ background: '#0e63b6' }} />ক্রয়</span></div>
            </div>
          </div>

          <div className="mq-grid cols-3 mq-mt">
            <div className="mq-card mq-card-pad">
              <p className="mq-card-title">পেমেন্ট মাধ্যম</p>
              <p className="mq-card-sub">{range.from} → {range.to}</p>
              {data.payMethods.length ? (
                <DonutChart data={data.payMethods.map((p) => ({ label: PAYMENT_METHOD_BN[p.method as keyof typeof PAYMENT_METHOD_BN] || p.method, value: p.total }))} formatV={fmt} />
              ) : <EmptyState title="পেমেন্ট তথ্য নেই" />}
            </div>
            <div className="mq-card mq-card-pad">
              <p className="mq-card-title">সেরা বিক্রীত পণ্য</p>
              <p className="mq-card-sub">রেভিনিউ অনুযায়ী শীর্ষ ১০</p>
              {data.topProducts.length ? (
                <div>
                  {data.topProducts.slice(0, 6).map((p) => (
                    <div key={p.id} className="mq-list-row" style={{ padding: '8px 0' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, fontSize: 13 }}>{p.name}</div>
                        <div className="mq-small mq-muted">{formatQty(p.qty_milli)} বিক্রীত</div>
                      </div>
                      <strong>{fmt(p.revenue)}</strong>
                    </div>
                  ))}
                </div>
              ) : <EmptyState title="এখনও কোনো বিক্রয় রেকর্ড নেই" />}
            </div>
            <div className="mq-card mq-card-pad">
              <p className="mq-card-title">বকেয়া / দেনা</p>
              <p className="mq-card-sub">শীর্ষ পাওনা ও দেনা</p>
              {data.topReceivables.length === 0 && data.topPayables.length === 0 && <EmptyState title="কোনো বকেয়া বা দেনা নেই" sub="সব হিসাব পরিষ্কার 🎉" />}
              {data.topReceivables.slice(0, 4).map((c) => (
                <div key={'c' + c.id} className="mq-list-row" style={{ padding: '8px 0' }}>
                  <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 13 }}>{c.name}</div><Badge tone="amber">পাওনা</Badge></div>
                  <strong>{fmt(c.due)}</strong>
                </div>
              ))}
              {data.topPayables.slice(0, 4).map((s) => (
                <div key={'s' + s.id} className="mq-list-row" style={{ padding: '8px 0' }}>
                  <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 13 }}>{s.name}</div><Badge tone="red">দেনা</Badge></div>
                  <strong>{fmt(s.payable)}</strong>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </Layout>
  );
}

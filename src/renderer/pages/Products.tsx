import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import {
  Package, Plus, Search, Eye, Pencil, Trash2, Tags, Layers, AlertTriangle,
  ClipboardList, History, CalendarClock, Printer,
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { PageHeader, Modal, EmptyState, Badge, Pagination, Field, Spinner, useDebouncedValue, Confirm, FormSection } from '../components/ui';
import { call, api } from '../api';
import { useApp, useMoney } from '../store';
import { formatQty, toMilli, fromMilli } from '@shared/qty';
import { MOVEMENT_BN, MovementType } from '@shared/constants';
import type { Brand, Category, Paged, Product, Supplier, Unit } from '@shared/types';

export function Products(): React.ReactElement {
  const [tab, setTab] = useState<'list' | 'masters' | 'stock' | 'movements' | 'expiry'>('list');
  const [params] = useSearchParams();
  const [stockFilter, setStockFilter] = useState('all');
  useEffect(() => {
    const s = params.get('stock');
    if (s === 'low') setStockFilter('low');
  }, [params]);

  return (
    <Layout title="পণ্য ও স্টক" sub="পণ্য, ক্যাটাগরি, স্টক ও মুভমেন্ট">
      <div className="mq-tabs">
        <button className={tab === 'list' ? 'active' : ''} onClick={() => setTab('list')}><Package /> পণ্য তালিকা</button>
        <button className={tab === 'masters' ? 'active' : ''} onClick={() => setTab('masters')}><Tags /> ক্যাটাগরি / ব্র্যান্ড / একক</button>
        <button className={tab === 'stock' ? 'active' : ''} onClick={() => setTab('stock')}><ClipboardList /> স্টক সমন্বয় ও গণনা</button>
        <button className={tab === 'movements' ? 'active' : ''} onClick={() => setTab('movements')}><History /> স্টক মুভমেন্ট</button>
        <button className={tab === 'expiry' ? 'active' : ''} onClick={() => setTab('expiry')}><CalendarClock /> মেয়াদ ও ব্যাচ</button>
      </div>
      {tab === 'list' && <ProductList stockFilter={stockFilter} setStockFilter={setStockFilter} />}
      {tab === 'masters' && <Masters />}
      {tab === 'stock' && <StockOps />}
      {tab === 'movements' && <Movements />}
      {tab === 'expiry' && <Expiry />}
    </Layout>
  );
}

/* ================= Product list ================= */

function ProductList({ stockFilter, setStockFilter }: { stockFilter: string; setStockFilter: (v: string) => void }): React.ReactElement {
  const { can, fail, notify } = useApp();
  const { fmt } = useMoney();
  const [params] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const debouncedQ = useDebouncedValue(q, 300);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<Product>>({ rows: [], total: 0, page: 1, pageSize: 50 });
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(params.get('new') === '1');
  const [editing, setEditing] = useState<Product | null>(null);
  const [detail, setDetail] = useState<Product | null>(null);
  const [deleting, setDeleting] = useState<Product | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call<Paged<Product>>('product.list', { opts: { q: debouncedQ, stock: stockFilter, page, pageSize: 50 } });
      setData(r);
    } catch (e) { fail(e); }
    finally { setLoading(false); }
  }, [debouncedQ, stockFilter, page, fail]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [debouncedQ, stockFilter]);

  const doDelete = async (): Promise<void> => {
    if (!deleting) return;
    setBusy(true);
    try {
      await call('product.delete', { id: deleting.id });
      notify('success', 'পণ্য মুছে ফেলা হয়েছে।');
      setDeleting(null);
      load();
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  };

  const stockBadge = (p: Product): React.ReactElement => {
    if (p.stock_milli <= 0) return <Badge tone="red">স্টক শেষ</Badge>;
    if (p.min_stock_milli > 0 && p.stock_milli <= p.min_stock_milli) return <Badge tone="amber">স্টক কম</Badge>;
    return <Badge tone="green">স্বাভাবিক</Badge>;
  };

  return (
    <div>
      <PageHeader title="পণ্য তালিকা" sub={`মোট ${data.total}টি পণ্য`}>
        {can('product.create') && <button className="mq-btn primary" onClick={() => { setEditing(null); setFormOpen(true); }}><Plus /> নতুন পণ্য (F3)</button>}
      </PageHeader>
      <div className="mq-toolbar">
        <div className="grow mq-search-wrap"><Search /><input className="mq-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="নাম, SKU বা বারকোড খুঁজুন" /></div>
        <div className="mq-segment">
          {[['all', 'সব'], ['low', 'স্টক কম'], ['out', 'স্টক শেষ'], ['over', 'অতিরিক্ত']].map(([v, l]) => (
            <button key={v} className={stockFilter === v ? 'active' : ''} onClick={() => setStockFilter(v)}>{l}</button>
          ))}
        </div>
      </div>
      {loading ? <Spinner /> : data.rows.length === 0 ? (
        <div className="mq-card"><EmptyState icon={<Package />} title="এখনও কোনো পণ্য যোগ করা হয়নি" sub="প্রথম পণ্যটি যোগ করে শুরু করুন।"
          action={can('product.create') ? <button className="mq-btn primary" onClick={() => { setEditing(null); setFormOpen(true); }}><Plus /> নতুন পণ্য যোগ করুন</button> : undefined} /></div>
      ) : (
        <div className="mq-table-wrap">
          <table className="mq-table">
            <thead><tr><th>পণ্য</th><th>বারকোড / SKU</th><th>ক্যাটাগরি</th><th className="num">ক্রয়মূল্য</th><th className="num">বিক্রয়মূল্য</th><th className="num">স্টক</th><th>অবস্থা</th><th className="center">কার্যক্রম</th></tr></thead>
            <tbody>
              {data.rows.map((p) => (
                <tr key={p.id}>
                  <td><strong>{p.name}</strong><div className="mq-small mq-muted">{p.brand_name || ''} {p.unit_name ? `• ${p.unit_name}` : ''}</div></td>
                  <td className="mq-mono mq-small">{p.barcode || p.sku || '—'}</td>
                  <td>{p.category_name || '—'}</td>
                  <td className="num">{can('product.view_cost') ? fmt(p.purchase_price) : '•••'}</td>
                  <td className="num">{fmt(p.selling_price)}</td>
                  <td className="num">{formatQty(p.stock_milli)}</td>
                  <td>{stockBadge(p)}</td>
                  <td><div className="mq-row-actions">
                    <button className="mq-mini-btn" title="বিস্তারিত" onClick={() => setDetail(p)}><Eye /></button>
                    {can('product.edit') && <button className="mq-mini-btn" title="সম্পাদনা" onClick={() => { setEditing(p); setFormOpen(true); }}><Pencil /></button>}
                    {can('product.delete') && <button className="mq-mini-btn danger" title="মুছুন" onClick={() => setDeleting(p)}><Trash2 /></button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />

      {formOpen && <ProductForm initial={editing} onClose={() => { setFormOpen(false); setEditing(null); }} onSaved={() => { setFormOpen(false); setEditing(null); load(); }} />}
      {detail && <ProductDetail p={detail} onClose={() => setDetail(null)} />}
      {deleting && (
        <Confirm title="পণ্য মুছে ফেলুন" message={`“${deleting.name}” পণ্যটি মুছে ফেলা হবে।`} consequences={['লেনদেন থাকলে মোছা যাবে না — তখন নিষ্ক্রিয় করুন']} danger
          onCancel={() => setDeleting(null)} onConfirm={doDelete} busy={busy} />
      )}
    </div>
  );
}

/* ================= Product form ================= */

function ProductForm({ initial, onClose, onSaved }: { initial: Product | null; onClose: () => void; onSaved: () => void }): React.ReactElement {
  const { can, fail, notify } = useApp();
  const [cats, setCats] = useState<Category[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    name: initial?.name || '',
    sku: initial?.sku || '',
    barcode: initial?.barcode || '',
    category_id: initial?.category_id ? String(initial.category_id) : '',
    brand_id: initial?.brand_id ? String(initial.brand_id) : '',
    unit_id: initial?.unit_id ? String(initial.unit_id) : '',
    purchase_price: initial ? String(initial.purchase_price / 100) : '',
    selling_price: initial ? String(initial.selling_price / 100) : '',
    wholesale_price: initial?.wholesale_price ? String(initial.wholesale_price / 100) : '',
    min_selling_price: initial?.min_selling_price ? String(initial.min_selling_price / 100) : '',
    min_stock: initial ? String(fromMilli(initial.min_stock_milli)) : '',
    max_stock: initial?.max_stock_milli ? String(fromMilli(initial.max_stock_milli)) : '',
    reorder: initial?.reorder_milli ? String(fromMilli(initial.reorder_milli)) : '',
    supplier_id: initial?.supplier_id ? String(initial.supplier_id) : '',
    tax_bp: initial ? String(initial.tax_bp / 100) : '',
    batch_tracked: !!initial?.batch_tracked,
    expiry_tracked: !!initial?.expiry_tracked,
    status: initial?.status || 'active',
    notes: initial?.notes || '',
    opening_stock: '',
  });
  const [error, setError] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const [c, b, u, s] = await Promise.all([
          call<Category[]>('master.list', { table: 'categories' }),
          call<Brand[]>('master.list', { table: 'brands' }),
          call<Unit[]>('master.list', { table: 'units' }),
          call<Paged<Supplier>>('supplier.list', { opts: { page: 1, pageSize: 500 } }),
        ]);
        setCats(c); setBrands(b); setUnits(u); setSuppliers(s.rows);
      } catch (e) { fail(e); }
    })();
  }, [fail]);

  const num = (v: string): number => (v.trim() ? Math.round(parseFloat(v) * 100) || 0 : 0);

  const submit = async (): Promise<void> => {
    if (!f.name.trim()) { setError('পণ্যের নাম আবশ্যক।'); return; }
    setBusy(true);
    setError('');
    try {
      const input = {
        name: f.name.trim(),
        sku: f.sku.trim() || null,
        barcode: f.barcode.trim() || null,
        category_id: f.category_id ? Number(f.category_id) : null,
        brand_id: f.brand_id ? Number(f.brand_id) : null,
        unit_id: f.unit_id ? Number(f.unit_id) : null,
        purchase_price: num(f.purchase_price),
        selling_price: num(f.selling_price),
        wholesale_price: num(f.wholesale_price),
        min_selling_price: num(f.min_selling_price),
        min_stock_milli: f.min_stock.trim() ? toMilli(parseFloat(f.min_stock) || 0) : 0,
        max_stock_milli: f.max_stock.trim() ? toMilli(parseFloat(f.max_stock) || 0) : 0,
        reorder_milli: f.reorder.trim() ? toMilli(parseFloat(f.reorder) || 0) : 0,
        supplier_id: f.supplier_id ? Number(f.supplier_id) : null,
        tax_bp: f.tax_bp.trim() ? Math.round((parseFloat(f.tax_bp) || 0) * 100) : 0,
        batch_tracked: f.batch_tracked,
        expiry_tracked: f.expiry_tracked,
        status: f.status as 'active' | 'inactive',
        notes: f.notes.trim() || null,
        opening_stock_milli: !initial && f.opening_stock.trim() ? toMilli(parseFloat(f.opening_stock) || 0) : 0,
      };
      if (initial) {
        await call('product.update', { id: initial.id, input });
        notify('success', 'পণ্য হালনাগাদ করা হয়েছে।');
      } else {
        await call('product.create', { input });
        notify('success', 'নতুন পণ্য যোগ করা হয়েছে।');
      }
      onSaved();
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  };

  const set = (k: keyof typeof f, v: string | boolean): void => setF({ ...f, [k]: v });
  const genBarcode = (): void => {
    const code = `20${Date.now().toString().slice(-8)}${Math.floor(Math.random() * 90 + 10)}`;
    set('barcode', code);
  };

  return (
    <Modal title={initial ? 'পণ্য সম্পাদনা' : 'নতুন পণ্য'} sub={initial ? initial.name : 'পণ্যের তথ্য দিন'} onClose={onClose} size="lg" footer={(
      <>
        <button className="mq-btn" onClick={onClose}>বাতিল করুন</button>
        <button className="mq-btn primary" onClick={submit} disabled={busy}>{busy ? 'সংরক্ষণ হচ্ছে…' : 'সংরক্ষণ করুন'}</button>
      </>
    )}>
      <FormSection title="পণ্যের পরিচিতি" icon={<Package />}>
        <Field label="পণ্যের নাম" required><input className="mq-input" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="যেমন: চিনি (১ কেজি)" autoFocus /></Field>
        <Field label="SKU"><input className="mq-input" value={f.sku} onChange={(e) => set('sku', e.target.value)} placeholder="যেমন: SGR-001" /></Field>
        <Field label="বারকোড" hint="স্ক্যানার দিয়ে স্ক্যান করুন বা তৈরি করুন">
          <div className="mq-flex" style={{ gap: 8 }}>
            <input className="mq-input" value={f.barcode} onChange={(e) => set('barcode', e.target.value)} placeholder="বারকোড" />
            <button className="mq-btn sm" onClick={genBarcode}>তৈরি</button>
          </div>
        </Field>
      </FormSection>
      <FormSection title="শ্রেণিবিন্যাস" icon={<Tags />}>
        <Field label="ক্যাটাগরি">
          <select className="mq-select" value={f.category_id} onChange={(e) => set('category_id', e.target.value)}>
            <option value="">নির্বাচন করুন</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="ব্র্যান্ড">
          <select className="mq-select" value={f.brand_id} onChange={(e) => set('brand_id', e.target.value)}>
            <option value="">নির্বাচন করুন</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <Field label="একক">
          <select className="mq-select" value={f.unit_id} onChange={(e) => set('unit_id', e.target.value)}>
            <option value="">নির্বাচন করুন</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </Field>
        <Field label="অবস্থা">
          <select className="mq-select" value={f.status} onChange={(e) => set('status', e.target.value)}>
            <option value="active">সক্রিয়</option>
            <option value="inactive">নিষ্ক্রিয়</option>
          </select>
        </Field>
      </FormSection>
      <FormSection title="মূল্য" icon={<ClipboardList />}>
        {can('product.view_cost') && (
          <Field label="ক্রয়মূল্য (৳)" required><input className="mq-input" inputMode="decimal" value={f.purchase_price} onChange={(e) => set('purchase_price', e.target.value)} placeholder="০" /></Field>
        )}
        <Field label="বিক্রয়মূল্য (৳)" required><input className="mq-input" inputMode="decimal" value={f.selling_price} onChange={(e) => set('selling_price', e.target.value)} placeholder="০" /></Field>
        <Field label="পাইকারি মূল্য (৳)"><input className="mq-input" inputMode="decimal" value={f.wholesale_price} onChange={(e) => set('wholesale_price', e.target.value)} placeholder="০" /></Field>
        <Field label="সর্বনিম্ন বিক্রয়মূল্য (৳)"><input className="mq-input" inputMode="decimal" value={f.min_selling_price} onChange={(e) => set('min_selling_price', e.target.value)} placeholder="০" /></Field>
        <Field label="ভ্যাট % (পণ্য-ভিত্তিক)"><input className="mq-input" inputMode="decimal" value={f.tax_bp} onChange={(e) => set('tax_bp', e.target.value)} placeholder="০" /></Field>
      </FormSection>
      <FormSection title="ইনভেন্টরি" icon={<Layers />}>
        {!initial && <Field label="প্রারম্ভিক স্টক"><input className="mq-input" inputMode="decimal" value={f.opening_stock} onChange={(e) => set('opening_stock', e.target.value)} placeholder="০" /></Field>}
        <Field label="সর্বনিম্ন স্টক"><input className="mq-input" inputMode="decimal" value={f.min_stock} onChange={(e) => set('min_stock', e.target.value)} placeholder="০" /></Field>
        <Field label="সর্বোচ্চ স্টক"><input className="mq-input" inputMode="decimal" value={f.max_stock} onChange={(e) => set('max_stock', e.target.value)} placeholder="০" /></Field>
        <div className="mq-flex" style={{ gap: 18, gridColumn: '1 / -1' }}>
          <label className="mq-check"><input type="checkbox" checked={f.batch_tracked} onChange={(e) => set('batch_tracked', e.target.checked)} /> ব্যাচ ট্র্যাকিং</label>
          <label className="mq-check"><input type="checkbox" checked={f.expiry_tracked} onChange={(e) => set('expiry_tracked', e.target.checked)} /> মেয়াদ ট্র্যাকিং</label>
        </div>
      </FormSection>
      <FormSection title="সরবরাহকারী ও নোট" icon={<History />}>
        <Field label="সরবরাহকারী">
          <select className="mq-select" value={f.supplier_id} onChange={(e) => set('supplier_id', e.target.value)}>
            <option value="">নির্বাচন করুন</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="মন্তব্য"><input className="mq-input" value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="ঐচ্ছিক" /></Field>
      </FormSection>
      {error && <div className="mq-alert error mq-mt">{error}</div>}
    </Modal>
  );
}

/* ================= Product detail ================= */

function ProductDetail({ p, onClose }: { p: Product; onClose: () => void }): React.ReactElement {
  const { fail } = useApp();
  const { fmt } = useMoney();
  const [full, setFull] = useState<Product | null>(null);
  const [qr, setQr] = useState('');
  const barcodeRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await call<Product>('product.get', { id: p.id });
        setFull(r);
        if (r.barcode) {
          try { setQr(await QRCode.toDataURL(r.barcode, { width: 120, margin: 1 })); } catch { /* noop */ }
        }
      } catch (e) { fail(e); }
    })();
  }, [p.id, fail]);

  useEffect(() => {
    if (full?.barcode && barcodeRef.current) {
      try {
        JsBarcode(barcodeRef.current, full.barcode, { format: 'CODE128', width: 2, height: 56, displayValue: true, fontSize: 12 });
      } catch { /* invalid for CODE128 */ }
    }
  }, [full]);

  const printLabel = async (): Promise<void> => {
    if (!full) return;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>/*__MQ_FONT__*/body{font-family:'Noto Sans Bengali',sans-serif;text-align:center;padding:20px;}h2{margin:4px 0;}p{margin:2px 0;font-size:18px;}</style></head><body><h2>${full.name}</h2><p>${fmt(full.selling_price)}</p><p style="font-size:13px">${full.barcode || full.sku || ''}</p></body></html>`;
    await api.preview({ html, title: `লেবেল ${full.name}` });
  };

  const d = full || p;
  return (
    <Modal title={d.name} sub={`${d.category_name || '—'} • ${d.brand_name || ''}`} onClose={onClose} footer={(
      <>
        <button className="mq-btn" onClick={onClose}>বন্ধ করুন</button>
        <button className="mq-btn" onClick={printLabel}><Printer /> লেবেল প্রিভিউ</button>
      </>
    )}>
      <div className="mq-grid cols-2">
        <div>
          <p className="mq-small mq-muted" style={{ margin: '0 0 4px' }}>দাম ও স্টক</p>
          <div className="mq-list-row" style={{ padding: '6px 0' }}><span>বিক্রয়মূল্য</span><strong style={{ marginLeft: 'auto' }}>{fmt(d.selling_price)}</strong></div>
          <div className="mq-list-row" style={{ padding: '6px 0' }}><span>ক্রয়মূল্য</span><strong style={{ marginLeft: 'auto' }}>{fmt(d.purchase_price)}</strong></div>
          <div className="mq-list-row" style={{ padding: '6px 0' }}><span>বর্তমান স্টক</span><strong style={{ marginLeft: 'auto' }}>{formatQty(d.stock_milli)} {d.unit_name || ''}</strong></div>
          <div className="mq-list-row" style={{ padding: '6px 0' }}><span>সর্বনিম্ন স্টক</span><strong style={{ marginLeft: 'auto' }}>{formatQty(d.min_stock_milli)}</strong></div>
          <p className="mq-small mq-muted" style={{ margin: '10px 0 4px' }}>সনাক্তকরণ</p>
          <div className="mq-list-row" style={{ padding: '6px 0' }}><span>SKU</span><strong style={{ marginLeft: 'auto' }}>{d.sku || '—'}</strong></div>
          <div className="mq-list-row" style={{ padding: '6px 0' }}><span>বারকোড</span><strong style={{ marginLeft: 'auto' }}>{d.barcode || '—'}</strong></div>
        </div>
        <div style={{ textAlign: 'center' }}>
          {d.barcode ? (
            <>
              <svg ref={barcodeRef} style={{ maxWidth: '100%' }} />
              {qr && <div style={{ marginTop: 10 }}><img src={qr} alt="QR" /><div className="mq-small mq-muted">QR কোড</div></div>}
            </>
          ) : <p className="mq-muted">বারকোড নেই</p>}
        </div>
      </div>
    </Modal>
  );
}

/* ================= Masters ================= */

function Masters(): React.ReactElement {
  const { fail, notify, can } = useApp();
  const [table, setTable] = useState<'categories' | 'brands' | 'units'>('categories');
  const [rows, setRows] = useState<{ id: number; name: string }[]>([]);
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await call<{ id: number; name: string }[]>('master.list', { table });
      setRows(r);
    } catch (e) { fail(e); }
  }, [table, fail]);

  useEffect(() => { load(); }, [load]);

  const add = async (): Promise<void> => {
    if (!name.trim()) return;
    try {
      await call('master.create', { table, name: name.trim() });
      notify('success', 'তথ্য সংরক্ষণ করা হয়েছে।');
      setName('');
      load();
    } catch (e) { fail(e); }
  };

  return (
    <div className="mq-grid cols-2">
      <div className="mq-card mq-card-pad">
        <div className="mq-segment" style={{ marginBottom: 12 }}>
          <button className={table === 'categories' ? 'active' : ''} onClick={() => setTable('categories')}>ক্যাটাগরি</button>
          <button className={table === 'brands' ? 'active' : ''} onClick={() => setTable('brands')}>ব্র্যান্ড</button>
          <button className={table === 'units' ? 'active' : ''} onClick={() => setTable('units')}>একক</button>
        </div>
        {can('product.create') && (
          <div className="mq-flex" style={{ marginBottom: 12 }}>
            <input className="mq-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="নতুন নাম লিখুন" onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
            <button className="mq-btn primary" onClick={add}><Plus /> যোগ</button>
          </div>
        )}
        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          {rows.length === 0 && <p className="mq-muted">কোনো তথ্য নেই।</p>}
          {rows.map((r) => (
            <div key={r.id} className="mq-list-row">
              <strong>{r.name}</strong>
              <div className="mq-row-actions" style={{ marginLeft: 'auto' }}>
                {can('product.edit') && <button className="mq-mini-btn" onClick={() => setEditing(r)}><Pencil /></button>}
                {can('product.delete') && <button className="mq-mini-btn danger" onClick={async () => {
                  try { await call('master.delete', { table, id: r.id }); notify('success', 'মুছে ফেলা হয়েছে।'); load(); } catch (e) { fail(e); }
                }}><Trash2 /></button>}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="mq-card mq-card-pad">
        <p className="mq-card-title">নির্দেশনা</p>
        <p className="mq-card-sub">ক্যাটাগরি, ব্র্যান্ড ও একক পণ্য যোগ করার সময় ব্যবহার হবে। যেসব নামের সাথে পণ্য যুক্ত আছে সেগুলো মোছা যাবে না।</p>
        <div className="mq-alert info"><Layers /> ডিফল্ট একক (পিস, কেজি, লিটার ইত্যাদি) সেটআপের সময় তৈরি হয়েছে। প্রয়োজনে নতুন একক যোগ করুন।</div>
      </div>
      {editing && (
        <Modal title="নাম পরিবর্তন" onClose={() => setEditing(null)} footer={(
          <>
            <button className="mq-btn" onClick={() => setEditing(null)}>বাতিল করুন</button>
            <button className="mq-btn primary" onClick={async () => {
              try { await call('master.rename', { table, id: editing.id, name: editing.name }); notify('success', 'তথ্য সংরক্ষণ করা হয়েছে।'); setEditing(null); load(); } catch (e) { fail(e); }
            }}>সংরক্ষণ করুন</button>
          </>
        )}>
          <Field label="নাম" required><input className="mq-input" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} autoFocus /></Field>
        </Modal>
      )}
    </div>
  );
}

/* ================= Stock ops ================= */

function StockOps(): React.ReactElement {
  const { can, fail, notify } = useApp();
  const [products, setProducts] = useState<Product[]>([]);
  const [pid, setPid] = useState('');
  const [newStock, setNewStock] = useState('');
  const [reason, setReason] = useState('');
  const [dmgQty, setDmgQty] = useState('');
  const [dmgType, setDmgType] = useState<'DAMAGE' | 'LOST'>('DAMAGE');
  const [dmgReason, setDmgReason] = useState('');
  const [countRows, setCountRows] = useState<{ product_id: number; name: string; system: number; counted: string }[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await call<Paged<Product>>('product.list', { opts: { page: 1, pageSize: 1000 } });
        setProducts(r.rows);
        setCountRows(r.rows.slice(0, 200).map((p) => ({ product_id: p.id, name: p.name, system: p.stock_milli, counted: '' })));
      } catch (e) { fail(e); }
    })();
  }, [fail]);

  const adjust = async (): Promise<void> => {
    if (!pid || !newStock.trim() || !reason.trim()) { notify('error', 'পণ্য, নতুন স্টক ও কারণ দিন।'); return; }
    setBusy(true);
    try {
      await call('stock.adjust', { productId: Number(pid), newMilli: toMilli(parseFloat(newStock) || 0), reason: reason.trim() });
      notify('success', 'স্টক সমন্বয় করা হয়েছে।');
      setNewStock(''); setReason('');
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  };

  const damage = async (): Promise<void> => {
    if (!pid || !dmgQty.trim()) { notify('error', 'পণ্য ও পরিমাণ দিন।'); return; }
    setBusy(true);
    try {
      await call('stock.damage', { productId: Number(pid), qtyMilli: toMilli(parseFloat(dmgQty) || 0), type: dmgType, reason: dmgReason.trim() });
      notify('success', 'রেকর্ড সংরক্ষণ করা হয়েছে।');
      setDmgQty(''); setDmgReason('');
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  };

  const saveCount = async (): Promise<void> => {
    const items = countRows.filter((r) => r.counted.trim() !== '').map((r) => ({ product_id: r.product_id, counted_milli: toMilli(parseFloat(r.counted) || 0) }));
    if (!items.length) { notify('error', 'কমপক্ষে একটি পণ্যের গণনা লিখুন।'); return; }
    setBusy(true);
    try {
      const r = await call<{ reference: string }>('stock.count', { items });
      notify('success', `স্টক গণনা সংরক্ষণ করা হয়েছে (${r.reference})।`);
      setCountRows((rows) => rows.map((x) => ({ ...x, counted: '' })));
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  };

  if (!can('inventory.adjust') && !can('inventory.count')) {
    return <div className="mq-alert warn">এই পেজটি দেখার অনুমতি আপনার নেই।</div>;
  }

  return (
    <div className="mq-grid cols-2">
      <div className="mq-card mq-card-pad">
        <p className="mq-card-title">স্টক সমন্বয়</p>
        <p className="mq-card-sub">ভুল স্টক ঠিক করতে নতুন সঠিক স্টক লিখুন</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <Field label="পণ্য" required>
            <select className="mq-select" value={pid} onChange={(e) => setPid(e.target.value)}>
              <option value="">নির্বাচন করুন</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name} (বর্তমান: {formatQty(p.stock_milli)})</option>)}
            </select>
          </Field>
          <Field label="নতুন স্টক" required><input className="mq-input" inputMode="decimal" value={newStock} onChange={(e) => setNewStock(e.target.value)} /></Field>
          <Field label="কারণ" required><input className="mq-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="যেমন: গণনায় ভুল পাওয়া গেছে" /></Field>
          <button className="mq-btn primary" onClick={adjust} disabled={busy || !can('inventory.adjust')}>সমন্বয় সংরক্ষণ করুন</button>
        </div>
        <hr className="mq-divider" />
        <p className="mq-card-title">ক্ষতিগ্রস্ত / হারানো</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
          <div className="mq-segment">
            <button className={dmgType === 'DAMAGE' ? 'active' : ''} onClick={() => setDmgType('DAMAGE')}>ক্ষতিগ্রস্ত</button>
            <button className={dmgType === 'LOST' ? 'active' : ''} onClick={() => setDmgType('LOST')}>হারানো</button>
          </div>
          <Field label="পরিমাণ" required><input className="mq-input" inputMode="decimal" value={dmgQty} onChange={(e) => setDmgQty(e.target.value)} /></Field>
          <Field label="কারণ"><input className="mq-input" value={dmgReason} onChange={(e) => setDmgReason(e.target.value)} placeholder="যেমন: প্যাকেট ছিঁড়ে গেছে" /></Field>
          <button className="mq-btn" onClick={damage} disabled={busy || !can('inventory.adjust')}><AlertTriangle /> রেকর্ড করুন</button>
        </div>
      </div>
      <div className="mq-card mq-card-pad">
        <p className="mq-card-title">স্টক গণনা (রিকনসিলিয়েশন)</p>
        <p className="mq-card-sub">দোকানে গুনে প্রকৃত স্টক লিখুন — পার্থক্য স্বয়ংক্রিয়ভাবে সমন্বয় হবে</p>
        <div style={{ maxHeight: 400, overflowY: 'auto', border: '1px solid var(--mq-border)', borderRadius: 10 }}>
          {countRows.map((r) => (
            <div key={r.product_id} className="mq-list-row">
              <div style={{ flex: 1 }}><div style={{ fontWeight: 700, fontSize: 13 }}>{r.name}</div><div className="mq-small mq-muted">সিস্টেম: {formatQty(r.system)}</div></div>
              <input className="mq-input" style={{ width: 110 }} inputMode="decimal" placeholder="গণনা" value={r.counted} onChange={(e) => setCountRows((rows) => rows.map((x) => (x.product_id === r.product_id ? { ...x, counted: e.target.value } : x)))} />
            </div>
          ))}
        </div>
        <button className="mq-btn primary mq-mt" onClick={saveCount} disabled={busy || !can('inventory.count')}>গণনা সংরক্ষণ করুন</button>
      </div>
    </div>
  );
}

/* ================= Movements ================= */

function Movements(): React.ReactElement {
  const { fail } = useApp();
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<Record<string, unknown>>>({ rows: [], total: 0, page: 1, pageSize: 50 });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call<Paged<Record<string, unknown>>>('stock.movements', { opts: { type: type || undefined, page, pageSize: 50 } });
      setData(r);
    } catch (e) { fail(e); }
    finally { setLoading(false); }
  }, [type, page, fail]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [type]);

  return (
    <div>
      <PageHeader title="স্টক মুভমেন্ট লেজার" sub="প্রতিটি স্টক পরিবর্তনের ইতিহাস">
        <select className="mq-select" style={{ width: 200 }} value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">সব ধরন</option>
          {(Object.keys(MOVEMENT_BN) as MovementType[]).map((t) => <option key={t} value={t}>{MOVEMENT_BN[t]}</option>)}
        </select>
      </PageHeader>
      {loading ? <Spinner /> : data.rows.length === 0 ? (
        <div className="mq-card"><EmptyState icon={<History />} title="কোনো মুভমেন্ট নেই" /></div>
      ) : (
        <div className="mq-table-wrap">
          <table className="mq-table">
            <thead><tr><th>তারিখ</th><th>পণ্য</th><th>ধরন</th><th className="num">পরিবর্তন</th><th className="num">আগে</th><th className="num">পরে</th><th>কারণ</th><th>ব্যবহারকারী</th></tr></thead>
            <tbody>
              {data.rows.map((m) => (
                <tr key={String(m.id)}>
                  <td>{new Date(String(m.occurred_at)).toLocaleString('bn-BD')}</td>
                  <td><strong>{String(m.product_name || '')}</strong></td>
                  <td><Badge tone="blue">{MOVEMENT_BN[String(m.type) as MovementType] || String(m.type)}</Badge></td>
                  <td className="num" style={{ color: Number(m.qty_milli) < 0 ? 'var(--mq-red)' : 'var(--mq-green)', fontWeight: 800 }}>
                    {Number(m.qty_milli) > 0 ? '+' : ''}{formatQty(Number(m.qty_milli))}
                  </td>
                  <td className="num">{formatQty(Number(m.prev_milli))}</td>
                  <td className="num">{formatQty(Number(m.new_milli))}</td>
                  <td>{String(m.reason || '—')}</td>
                  <td>{String(m.user_name || '—')}</td>
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

/* ================= Expiry ================= */

function Expiry(): React.ReactElement {
  const { fail } = useApp();
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const r = await call<Record<string, unknown>[]>('report.expiry', { days });
        setRows(r);
      } catch (e) { fail(e); }
      finally { setLoading(false); }
    })();
  }, [days, fail]);

  return (
    <div>
      <PageHeader title="মেয়াদ ও ব্যাচ" sub="শীঘ্রই মেয়াদ শেষ হবে এমন পণ্য">
        <select className="mq-select" style={{ width: 200 }} value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>আগামী ৭ দিন</option>
          <option value={30}>আগামী ৩০ দিন</option>
          <option value={90}>আগামী ৯০ দিন</option>
        </select>
      </PageHeader>
      <div className="mq-alert info" style={{ marginBottom: 14 }}><CalendarClock /> ব্যাচ ও মেয়াদ ক্রয়ের সময় যোগ করুন। মেয়াদোত্তীর্ণ পণ্য বিক্রয় থেকে বিরত থাকুন।</div>
      {loading ? <Spinner /> : rows.length === 0 ? (
        <div className="mq-card"><EmptyState icon={<CalendarClock />} title="মেয়াদ-ঝুঁকিতে কোনো পণ্য নেই" /></div>
      ) : (
        <div className="mq-table-wrap">
          <table className="mq-table">
            <thead><tr><th>পণ্য</th><th>ব্যাচ</th><th>মেয়াদ</th><th className="num">পরিমাণ</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td><strong>{String(r.product_name)}</strong></td>
                  <td>{String(r.batch_no || '—')}</td>
                  <td><Badge tone="amber">{String(r.expiry_date)}</Badge></td>
                  <td className="num">{formatQty(Number(r.qty_milli))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

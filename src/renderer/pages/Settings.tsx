import React, { useCallback, useEffect, useState } from 'react';
import {
  Store, Receipt, Printer as PrinterIcon, ShoppingCart, Boxes, Percent, ShieldCheck,
  Bell, Database, Upload, Download, Lock, Activity, Info, Ruler,
} from 'lucide-react';
import { Layout } from '../components/Layout';
import { PageHeader, Field, Spinner, EmptyState, Badge } from '../components/ui';
import { call, api } from '../api';
import { useApp } from '../store';
import type { Business } from '@shared/types';

const SECTIONS = [
  { id: 'business', label: 'ব্যবসা', icon: <Store /> },
  { id: 'invoice', label: 'ইনভয়েস', icon: <Receipt /> },
  { id: 'printer', label: 'প্রিন্টার', icon: <PrinterIcon /> },
  { id: 'pos', label: 'POS', icon: <ShoppingCart /> },
  { id: 'inventory', label: 'স্টক', icon: <Boxes /> },
  { id: 'units', label: 'একক', icon: <Ruler /> },
  { id: 'tax', label: 'ভ্যাট/ট্যাক্স', icon: <Percent /> },
  { id: 'policy', label: 'নীতি', icon: <ShieldCheck /> },
  { id: 'notifications', label: 'নোটিফিকেশন', icon: <Bell /> },
  { id: 'backup', label: 'ব্যাকআপ', icon: <Database /> },
  { id: 'data', label: 'ইমপোর্ট/এক্সপোর্ট', icon: <Upload /> },
  { id: 'security', label: 'নিরাপত্তা', icon: <Lock /> },
  { id: 'system', label: 'সিস্টেম ও তথ্য', icon: <Activity /> },
];

export function Settings(): React.ReactElement {
  const [section, setSection] = useState('business');
  return (
    <Layout title="সেটিংস" sub="ব্যবসা, ইনভয়েস, প্রিন্টার, ব্যাকআপ ও সিস্টেম">
      <PageHeader title="সেটিংস" />
      <div className="mq-settings">
        <div className="mq-settings-nav">
          {SECTIONS.map((s) => (
            <button key={s.id} className={section === s.id ? 'active' : ''} onClick={() => setSection(s.id)}>
              {s.icon} {s.label}
            </button>
          ))}
        </div>
        <div className="mq-card mq-card-pad">
          {section === 'business' && <BusinessSection />}
          {section === 'invoice' && <InvoiceSection />}
          {section === 'printer' && <PrinterSection />}
          {section === 'pos' && <PosSection />}
          {section === 'inventory' && <InventorySection />}
          {section === 'units' && <UnitsSection />}
          {section === 'tax' && <TaxSection />}
          {section === 'policy' && <PolicySection />}
          {section === 'notifications' && <NotifSection />}
          {section === 'backup' && <BackupSection />}
          {section === 'data' && <DataSection />}
          {section === 'security' && <SecuritySection />}
          {section === 'system' && <SystemSection />}
        </div>
      </div>
    </Layout>
  );
}

function useBusiness(): { biz: Business | null; reload: () => Promise<void> } {
  const { fail, refreshMe } = useApp();
  const [biz, setBiz] = useState<Business | null>(null);
  const reload = useCallback(async () => {
    try {
      const b = await call<Business>('business.profile');
      setBiz(b);
      await refreshMe();
    } catch (e) { fail(e); }
  }, [fail, refreshMe]);
  useEffect(() => { reload(); }, [reload]);
  return { biz, reload };
}

function useSetting(key: string): { value: string; setValue: (v: string) => void; save: () => Promise<void>; loading: boolean } {
  const { fail, notify } = useApp();
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    (async () => {
      try {
        const s = await call<Record<string, string>>('settings.get');
        setValue(s[key] ?? '');
      } catch (e) { fail(e); }
      finally { setLoading(false); }
    })();
  }, [key, fail]);
  const save = async (): Promise<void> => {
    try {
      await call('settings.set', { key, value });
      notify('success', 'তথ্য সংরক্ষণ করা হয়েছে।');
    } catch (e) { fail(e); }
  };
  return { value, setValue, save, loading };
}

function BusinessSection(): React.ReactElement {
  const { can, fail, notify } = useApp();
  const { biz, reload } = useBusiness();
  const [f, setF] = useState({ name: '', owner_name: '', phone: '', email: '', address: '', business_type: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (biz) setF({ name: biz.name, owner_name: biz.owner_name || '', phone: biz.phone || '', email: biz.email || '', address: biz.address || '', business_type: biz.business_type || '' });
  }, [biz]);

  if (!biz) return <Spinner />;

  const save = async (): Promise<void> => {
    if (!f.name.trim()) { notify('error', 'ব্যবসার নাম আবশ্যক।'); return; }
    setBusy(true);
    try {
      await call('business.update', { input: { name: f.name.trim(), owner_name: f.owner_name.trim() || null, phone: f.phone.trim() || null, email: f.email.trim() || null, address: f.address.trim() || null, business_type: f.business_type || null } });
      notify('success', 'তথ্য সংরক্ষণ করা হয়েছে।');
      reload();
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <p className="mq-card-title">ব্যবসার প্রোফাইল</p>
      <p className="mq-card-sub">এই তথ্য ইনভয়েস ও রিপোর্টে দেখাবে</p>
      <div className="mq-form-grid">
        <Field label="ব্যবসার নাম" required><input className="mq-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="মালিকের নাম"><input className="mq-input" value={f.owner_name} onChange={(e) => setF({ ...f, owner_name: e.target.value })} /></Field>
        <Field label="মোবাইল"><input className="mq-input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
        <Field label="ইমেইল"><input className="mq-input" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="ঠিকানা"><input className="mq-input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
        <Field label="ব্যবসার ধরন"><input className="mq-input" value={f.business_type} onChange={(e) => setF({ ...f, business_type: e.target.value })} /></Field>
      </div>
      {can('settings.edit') && <button className="mq-btn primary mq-mt" onClick={save} disabled={busy}>{busy ? 'সংরক্ষণ হচ্ছে…' : 'সংরক্ষণ করুন'}</button>}
    </div>
  );
}

function InvoiceSection(): React.ReactElement {
  const { can, fail, notify } = useApp();
  const { biz, reload } = useBusiness();
  const [f, setF] = useState({ prefix: '', footer: '', terms: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (biz) setF({ prefix: biz.invoice_prefix, footer: biz.footer || '', terms: biz.terms || '' });
  }, [biz]);

  if (!biz) return <Spinner />;

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await call('business.update', { input: { invoice_prefix: f.prefix.trim() || 'MERQO', footer: f.footer || null, terms: f.terms || null } });
      notify('success', 'তথ্য সংরক্ষণ করা হয়েছে।');
      reload();
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <p className="mq-card-title">ইনভয়েস সেটআপ</p>
      <p className="mq-card-sub">ইনভয়েস নম্বর: {biz.invoice_prefix}-বছর-০০০০০১ ফরম্যাটে তৈরি হবে</p>
      <div className="mq-form-grid">
        <Field label="ইনভয়েস প্রিফিক্স"><input className="mq-input" value={f.prefix} onChange={(e) => setF({ ...f, prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} maxLength={10} /></Field>
        <div />
        <Field label="ফুটার"><input className="mq-input" value={f.footer} onChange={(e) => setF({ ...f, footer: e.target.value })} /></Field>
        <Field label="শর্তাবলি"><input className="mq-input" value={f.terms} onChange={(e) => setF({ ...f, terms: e.target.value })} /></Field>
      </div>
      {can('settings.edit') && <button className="mq-btn primary mq-mt" onClick={save} disabled={busy}>সংরক্ষণ করুন</button>}
    </div>
  );
}

function PrinterSection(): React.ReactElement {
  const { fail, notify } = useApp();
  const [printers, setPrinters] = useState<{ name: string; isDefault: boolean; status: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const invPrinter = useSetting('invoice_printer');
  const recPrinter = useSetting('receipt_printer');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.printers();
      if (r.ok) setPrinters((r.data as { name: string; isDefault: boolean; status: number }[]) || []);
      else notify('error', 'প্রিন্টার তালিকা পাওয়া যায়নি।');
    } catch { notify('error', 'প্রিন্টার তালিকা পাওয়া যায়নি।'); }
    finally { setLoading(false); }
  }, [notify]);

  useEffect(() => { load(); }, [load]);

  const testPrint = async (): Promise<void> => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>/*__MQ_FONT__*/body{font-family:'Noto Sans Bengali',sans-serif;padding:30px;}h2{color:#0e63b6;}</style></head><body><h2>MERQO. টেস্ট প্রিন্ট</h2><p>প্রিন্টার ঠিকভাবে কাজ করছে। তারিখ: ${new Date().toLocaleString('bn-BD')}</p><p>বাংলা লেখা: ক খ গ ঘ ঙ — ০১২৩৪৫৬৭৮৯</p></body></html>`;
    const r = await api.print({ html, silent: false });
    if (!r.ok) notify('error', 'টেস্ট প্রিন্ট ব্যর্থ হয়েছে।');
    else notify('success', 'টেস্ট প্রিন্ট পাঠানো হয়েছে।');
  };

  if (loading || invPrinter.loading) return <Spinner />;

  return (
    <div>
      <p className="mq-card-title">প্রিন্টার সেটআপ</p>
      <p className="mq-card-sub">ইনভয়েস ও রসিদের জন্য আলাদা প্রিন্টার নির্ধারণ করুন</p>
      {printers.length === 0 ? (
        <div className="mq-alert warn">কোনো প্রিন্টার পাওয়া যায়নি। প্রিন্টার সংযোগ করে রিফ্রেশ করুন — অথবা PDF ব্যবহার করুন।</div>
      ) : (
        <div className="mq-form-grid">
          <Field label="ইনভয়েস প্রিন্টার (A4)">
            <select className="mq-select" value={invPrinter.value} onChange={(e) => invPrinter.setValue(e.target.value)}>
              <option value="">ডিফল্ট প্রিন্টার</option>
              {printers.map((p) => <option key={p.name} value={p.name}>{p.name}{p.isDefault ? ' (ডিফল্ট)' : ''}</option>)}
            </select>
          </Field>
          <Field label="রসিদ প্রিন্টার (থার্মাল)">
            <select className="mq-select" value={recPrinter.value} onChange={(e) => recPrinter.setValue(e.target.value)}>
              <option value="">ডিফল্ট প্রিন্টার</option>
              {printers.map((p) => <option key={p.name} value={p.name}>{p.name}{p.isDefault ? ' (ডিফল্ট)' : ''}</option>)}
            </select>
          </Field>
        </div>
      )}
      <div className="mq-btn-row mq-mt">
        <button className="mq-btn" onClick={load}>রিফ্রেশ</button>
        <button className="mq-btn" onClick={testPrint}><PrinterIcon /> টেস্ট প্রিন্ট</button>
        <button className="mq-btn primary" onClick={async () => { await invPrinter.save(); await recPrinter.save(); }}>সংরক্ষণ করুন</button>
      </div>
      <div className="mq-alert info mq-mt"><Info /> প্রিন্ট ব্যর্থ হলেও বিক্রয় সংরক্ষিত থাকে — প্রিন্ট শুধু আউটপুট, লেনদেনের প্রমাণ নয়। ব্যর্থ হলে PDF নিন।</div>
    </div>
  );
}

function PosSection(): React.ReactElement {
  const { can, fail, notify } = useApp();
  const { biz, reload } = useBusiness();
  const [width, setWidth] = useState('80mm');
  const [digits, setDigits] = useState('en');

  useEffect(() => {
    if (biz) { setWidth(biz.receipt_width); setDigits(biz.digit_locale); }
  }, [biz]);

  if (!biz) return <Spinner />;

  const save = async (): Promise<void> => {
    try {
      await call('business.update', { input: { receipt_width: width, digit_locale: digits } });
      notify('success', 'তথ্য সংরক্ষণ করা হয়েছে।');
      reload();
    } catch (e) { fail(e); }
  };

  return (
    <div>
      <p className="mq-card-title">POS সেটিংস</p>
      <div className="mq-form-grid">
        <Field label="রসিদের প্রস্থ">
          <select className="mq-select" value={width} onChange={(e) => setWidth(e.target.value)}>
            <option value="80mm">৮০মিমি থার্মাল</option>
            <option value="58mm">৫৮মিমি থার্মাল</option>
          </select>
        </Field>
        <Field label="সংখ্যার ধরন">
          <select className="mq-select" value={digits} onChange={(e) => setDigits(e.target.value)}>
            <option value="en">ইংরেজি সংখ্যা (123)</option>
            <option value="bn">বাংলা সংখ্যা (১২৩)</option>
          </select>
        </Field>
      </div>
      <div className="mq-alert info mq-mt">কীবোর্ড শর্টকাট: F1 সার্চ • F2 নতুন বিক্রয় • F3 নতুন পণ্য • F4 কাস্টমার • F8 পেমেন্ট • F9 হোল্ড • F10 সম্পন্ন</div>
      {can('settings.edit') && <button className="mq-btn primary mq-mt" onClick={save}>সংরক্ষণ করুন</button>}
    </div>
  );
}

function InventorySection(): React.ReactElement {
  const { can, fail, notify } = useApp();
  const { biz, reload } = useBusiness();
  const [neg, setNeg] = useState(false);

  useEffect(() => { if (biz) setNeg(!!biz.negative_stock_allowed); }, [biz]);
  if (!biz) return <Spinner />;

  const save = async (): Promise<void> => {
    try {
      await call('business.update', { input: { negative_stock_allowed: neg } });
      notify('success', 'তথ্য সংরক্ষণ করা হয়েছে।');
      reload();
    } catch (e) { fail(e); }
  };

  return (
    <div>
      <p className="mq-card-title">স্টক নীতি</p>
      <label className="mq-check"><input type="checkbox" checked={neg} onChange={(e) => setNeg(e.target.checked)} /> নেগেটিভ স্টকে বিক্রয় অনুমোদন করুন</label>
      <div className="mq-alert warn mq-mt">নেগেটিভ স্টক চালু থাকলে স্টক না থাকলেও বিক্রয় করা যাবে। সাধারণত এটি বন্ধ রাখাই নিরাপদ। লাভ হিসাব FIFO পদ্ধতিতে হয়।</div>
      {can('settings.edit') && <button className="mq-btn primary mq-mt" onClick={save}>সংরক্ষণ করুন</button>}
    </div>
  );
}

function UnitsSection(): React.ReactElement {
  const { fail, notify, can } = useApp();
  const [rows, setRows] = useState<{ id: number; name: string }[]>([]);
  const [name, setName] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await call<{ id: number; name: string }[]>('master.list', { table: 'units' });
      setRows(r);
    } catch (e) { fail(e); }
  }, [fail]);

  useEffect(() => { load(); }, [load]);

  return (
    <div>
      <p className="mq-card-title">একক ব্যবস্থাপনা</p>
      <p className="mq-card-sub">পিস, কেজি, লিটার ইত্যাদি — ভগ্নাংশ পরিমাণ সমর্থিত</p>
      {can('product.create') && (
        <div className="mq-flex" style={{ marginBottom: 12 }}>
          <input className="mq-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="নতুন একক" onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) { call('master.create', { table: 'units', name: name.trim() }).then(() => { setName(''); load(); notify('success', 'তথ্য সংরক্ষণ করা হয়েছে।'); }).catch(fail); } }} />
          <button className="mq-btn primary" onClick={async () => {
            if (!name.trim()) return;
            try { await call('master.create', { table: 'units', name: name.trim() }); setName(''); load(); notify('success', 'তথ্য সংরক্ষণ করা হয়েছে।'); } catch (e) { fail(e); }
          }}>যোগ করুন</button>
        </div>
      )}
      {rows.map((r) => <div key={r.id} className="mq-list-row"><strong>{r.name}</strong></div>)}
    </div>
  );
}

function TaxSection(): React.ReactElement {
  const { can, fail, notify } = useApp();
  const { biz, reload } = useBusiness();
  const [mode, setMode] = useState('none');
  const [rate, setRate] = useState('');

  useEffect(() => { if (biz) { setMode(biz.tax_mode); setRate(String(biz.tax_default_bp / 100)); } }, [biz]);
  if (!biz) return <Spinner />;

  const save = async (): Promise<void> => {
    try {
      await call('business.update', { input: { tax_mode: mode, tax_default_bp: rate.trim() ? Math.round((parseFloat(rate) || 0) * 100) : 0 } });
      notify('success', 'তথ্য সংরক্ষণ করা হয়েছে।');
      reload();
    } catch (e) { fail(e); }
  };

  return (
    <div>
      <p className="mq-card-title">ভ্যাট / ট্যাক্স</p>
      <p className="mq-card-sub">ঐচ্ছিক — আপনার ব্যবসায় প্রযোজ্য হলে চালু করুন</p>
      <div className="mq-form-grid">
        <Field label="ট্যাক্স পদ্ধতি">
          <select className="mq-select" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="none">ট্যাক্স নেই</option>
            <option value="item">পণ্য-ভিত্তিক (%)</option>
            <option value="invoice">ইনভয়েস-ভিত্তিক (%)</option>
          </select>
        </Field>
        <Field label="ডিফল্ট হার (%)"><input className="mq-input" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="যেমন: ৫" /></Field>
      </div>
      {can('settings.edit') && <button className="mq-btn primary mq-mt" onClick={save}>সংরক্ষণ করুন</button>}
    </div>
  );
}

function PolicySection(): React.ReactElement {
  const { can, fail, notify } = useApp();
  const { biz, reload } = useBusiness();
  const [policy, setPolicy] = useState('block');

  useEffect(() => { if (biz) setPolicy(biz.overpayment_policy); }, [biz]);
  if (!biz) return <Spinner />;

  const save = async (): Promise<void> => {
    try {
      await call('business.update', { input: { overpayment_policy: policy } });
      notify('success', 'তথ্য সংরক্ষণ করা হয়েছে।');
      reload();
    } catch (e) { fail(e); }
  };

  return (
    <div>
      <p className="mq-card-title">অতিরিক্ত পেমেন্ট নীতি</p>
      <p className="mq-card-sub">বিলের চেয়ে বেশি টাকা দিলে কী হবে (কাস্টমারযুক্ত বিক্রয়ে)</p>
      <div className="mq-segment">
        <button className={policy === 'block' ? 'active' : ''} onClick={() => setPolicy('block')}>ব্লক করুন (নিরাপদ)</button>
        <button className={policy === 'advance' ? 'active' : ''} onClick={() => setPolicy('advance')}>অগ্রিম হিসেবে রাখুন</button>
      </div>
      <div className="mq-alert info mq-mt">ওয়াক-ইন (কাস্টমার ছাড়া) বিক্রয়ে অতিরিক্ত টাকা সবসময় <strong>ফেরত</strong> হিসেবে দেখানো হয়।</div>
      {can('settings.edit') && <button className="mq-btn primary mq-mt" onClick={save}>সংরক্ষণ করুন</button>}
    </div>
  );
}

function NotifSection(): React.ReactElement {
  const reminder = useSetting('backup_reminder_days');
  const expiry = useSetting('expiry_notify_days');
  if (reminder.loading || expiry.loading) return <Spinner />;
  return (
    <div>
      <p className="mq-card-title">নোটিফিকেশন পছন্দ</p>
      <div className="mq-form-grid">
        <Field label="ব্যাকআপ রিমাইন্ডার (দিন পর পর)" hint="এতদিন ব্যাকআপ না নিলে মনে করিয়ে দেবে">
          <input className="mq-input" inputMode="numeric" value={reminder.value} onChange={(e) => reminder.setValue(e.target.value)} />
        </Field>
        <Field label="মেয়াদ সতর্কতা (আগে কতদিন)" hint="মেয়াদের এতদিন আগে সতর্ক করবে">
          <input className="mq-input" inputMode="numeric" value={expiry.value} onChange={(e) => expiry.setValue(e.target.value)} />
        </Field>
      </div>
      <button className="mq-btn primary mq-mt" onClick={async () => { await reminder.save(); await expiry.save(); }}>সংরক্ষণ করুন</button>
    </div>
  );
}

function BackupSection(): React.ReactElement {
  const { can, fail, notify } = useApp();
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [restoreFile, setRestoreFile] = useState('');
  const autoExit = useSetting('auto_backup_on_exit');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call<Record<string, unknown>[]>('backup.list');
      setRows(r);
    } catch (e) { fail(e); }
    finally { setLoading(false); }
  }, [fail]);

  useEffect(() => { load(); }, [load]);

  const create = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await call<{ file: string; size: number }>('backup.create', {});
      notify('success', 'ব্যাকআপ তৈরি হয়েছে।');
      await api.shell('showItem', r.file);
      load();
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  };

  const pickFile = async (): Promise<void> => {
    const r = await api.dialog('openFile', { filters: [{ name: 'MERQO ব্যাকআপ', extensions: ['db'] }] });
    if (r.ok && (r.data as { canceled?: boolean; filePaths?: string[] })?.filePaths?.[0]) {
      setRestoreFile(((r.data as { filePaths: string[] }).filePaths)[0]);
    }
  };

  const restore = async (): Promise<void> => {
    if (!restoreFile) { notify('error', 'ব্যাকআপ ফাইল নির্বাচন করুন।'); return; }
    if (!window.confirm('সতর্কতা: বর্তমান সব তথ্য ব্যাকআপের তথ্য দিয়ে প্রতিস্থাপন হবে। প্রথমে বর্তমান তথ্যের নিরাপত্তা-ব্যাকআপ নেওয়া হবে। চালিয়ে যাবেন?')) return;
    setBusy(true);
    try {
      await call('backup.restore', { file: restoreFile });
      notify('success', 'পুনরুদ্ধার সম্পন্ন হয়েছে। অ্যাপ পুনরায় লোড হচ্ছে…');
      setTimeout(() => window.location.reload(), 1500);
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <p className="mq-card-title">ব্যাকআপ ও পুনরুদ্ধার</p>
      <p className="mq-card-sub">নিয়মিত ব্যাকআপ নিন — আপনার ব্যবসার নিরাপত্তা</p>
      <div className="mq-btn-row">
        {can('backup.create') && <button className="mq-btn primary" onClick={create} disabled={busy}><Database /> {busy ? 'তৈরি হচ্ছে…' : 'এখনই ব্যাকআপ নিন'}</button>}
      </div>
      <div className="mq-mt">
        <label className="mq-check">
          <input type="checkbox" checked={autoExit.value === '1'} onChange={(e) => autoExit.setValue(e.target.checked ? '1' : '0')} />
          অ্যাপ বন্ধ করার সময় স্বয়ংক্রিয় ব্যাকআপের কথা মনে করিয়ে দিন
        </label>
        <div><button className="mq-btn sm mq-mt" onClick={autoExit.save}>পছন্দ সংরক্ষণ করুন</button></div>
      </div>
      <hr className="mq-divider" />
      <p className="mq-card-title">পুনরুদ্ধার</p>
      <div className="mq-flex">
        <input className="mq-input" value={restoreFile} readOnly placeholder="ব্যাকআপ ফাইল (.db) নির্বাচন করুন" style={{ flex: 1 }} />
        <button className="mq-btn" onClick={pickFile}>ফাইল খুঁজুন</button>
        {can('backup.restore') && <button className="mq-btn danger" onClick={restore} disabled={busy || !restoreFile}>পুনরুদ্ধার করুন</button>}
      </div>
      <div className="mq-alert warn mq-mt">পুনরুদ্ধারের আগে বর্তমান তথ্যের স্বয়ংক্রিয় নিরাপত্তা-ব্যাকআপ নেওয়া হয়। তবুও সতর্ক থাকুন।</div>
      <hr className="mq-divider" />
      <p className="mq-card-title">ব্যাকআপ ইতিহাস</p>
      {loading ? <Spinner /> : rows.length === 0 ? <p className="mq-muted">এখনও কোনো ব্যাকআপ নেওয়া হয়নি।</p> : (
        <div className="mq-table-wrap">
          <table className="mq-table">
            <thead><tr><th>তারিখ</th><th>ফাইল</th><th className="num">সাইজ</th><th>যাচাই</th><th></th></tr></thead>
            <tbody>
              {rows.map((b) => (
                <tr key={String(b.id)}>
                  <td>{new Date(String(b.created_at)).toLocaleString('bn-BD')}</td>
                  <td className="mq-small mq-mono">{String(b.file_path).split(/[/\\]/).pop()}</td>
                  <td className="num">{(Number(b.size_bytes) / 1024).toFixed(1)} KB</td>
                  <td>{b.verified ? <Badge tone="green">যাচাইকৃত</Badge> : <Badge tone="gray">—</Badge>}</td>
                  <td><button className="mq-btn sm ghost" onClick={() => api.shell('showItem', String(b.file_path))}>ফোল্ডারে দেখুন</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

type ImportKind = 'products' | 'customers' | 'suppliers';

function DataSection(): React.ReactElement {
  const { can, fail, notify } = useApp();
  const [kind, setKind] = useState<ImportKind>('products');
  const [preview, setPreview] = useState<{ headers: string[]; rows: Record<string, string>[]; errors: { row: number; message: string }[]; validCount: number } | null>(null);
  const [busy, setBusy] = useState(false);

  const template = async (): Promise<void> => {
    try {
      const r = await call<{ file: string }>('import.template', { kind });
      notify('success', 'টেমপ্লেট তৈরি হয়েছে।');
      await api.shell('showItem', r.file);
    } catch (e) { fail(e); }
  };

  const pickAndPreview = async (): Promise<void> => {
    const d = await api.dialog('openFile', { filters: [{ name: 'CSV ফাইল', extensions: ['csv'] }] });
    const file = (d.data as { filePaths?: string[] })?.filePaths?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const p = await call<{ headers: string[]; rows: Record<string, string>[]; errors: { row: number; message: string }[]; validCount: number }>('import.preview', { kind, file });
      setPreview(p);
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  };

  const confirm = async (): Promise<void> => {
    if (!preview) return;
    const validRows = preview.rows.filter((_, i) => !preview.errors.some((e) => e.row === i + 2));
    if (!validRows.length) { notify('error', 'কোনো বৈধ সারি নেই।'); return; }
    setBusy(true);
    try {
      const r = await call<{ imported: number; skipped: number }>('import.confirm', { kind, rows: validRows });
      notify('success', `${r.imported}টি রেকর্ড ইমপোর্ট হয়েছে, ${r.skipped}টি বাদ গেছে।`);
      setPreview(null);
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  };

  const exportCsv = async (k: string): Promise<void> => {
    try {
      const r = await call<{ file: string }>('export.csv', { kind: k });
      notify('success', 'এক্সপোর্ট সম্পন্ন হয়েছে।');
      await api.shell('showItem', r.file);
    } catch (e) { fail(e); }
  };

  return (
    <div>
      <p className="mq-card-title">ইমপোর্ট</p>
      <p className="mq-card-sub">CSV ফাইল থেকে পণ্য, কাস্টমার বা সরবরাহকারী যোগ করুন</p>
      <div className="mq-btn-row">
        <div className="mq-segment">
          <button className={kind === 'products' ? 'active' : ''} onClick={() => { setKind('products'); setPreview(null); }}>পণ্য</button>
          <button className={kind === 'customers' ? 'active' : ''} onClick={() => { setKind('customers'); setPreview(null); }}>কাস্টমার</button>
          <button className={kind === 'suppliers' ? 'active' : ''} onClick={() => { setKind('suppliers'); setPreview(null); }}>সরবরাহকারী</button>
        </div>
        <button className="mq-btn" onClick={template}><Download /> টেমপ্লেট নিন</button>
        {can('import.run') && <button className="mq-btn" onClick={pickAndPreview} disabled={busy}><Upload /> ফাইল নির্বাচন ও প্রিভিউ</button>}
      </div>
      {preview && (
        <div className="mq-mt">
          <div className="mq-alert info">মোট {preview.rows.length} সারি • বৈধ {preview.validCount} • ভুল {preview.errors.length}</div>
          {preview.errors.length > 0 && (
            <div className="mq-alert error mq-mt">
              <div>
                <strong>ভুল সারি:</strong>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
                  {preview.errors.slice(0, 10).map((e) => <li key={e.row}>সারি {e.row}: {e.message}</li>)}
                </ul>
              </div>
            </div>
          )}
          <div className="mq-table-wrap mq-mt" style={{ maxHeight: 260 }}>
            <table className="mq-table">
              <thead><tr>{preview.headers.map((h) => <th key={h}>{h}</th>)}</tr></thead>
              <tbody>
                {preview.rows.slice(0, 50).map((r, i) => (
                  <tr key={i} style={preview.errors.some((e) => e.row === i + 2) ? { background: 'var(--mq-red-soft)' } : undefined}>
                    {preview.headers.map((h) => <td key={h}>{r[h]}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button className="mq-btn primary mq-mt" onClick={confirm} disabled={busy || preview.validCount === 0}>
            {preview.validCount}টি রেকর্ড ইমপোর্ট করুন
          </button>
        </div>
      )}
      <hr className="mq-divider" />
      <p className="mq-card-title">এক্সপোর্ট (CSV)</p>
      <div className="mq-btn-row">
        <button className="mq-btn" onClick={() => exportCsv('products')}>পণ্য</button>
        <button className="mq-btn" onClick={() => exportCsv('sales')}>বিক্রয়</button>
        <button className="mq-btn" onClick={() => exportCsv('customers')}>কাস্টমার</button>
        <button className="mq-btn" onClick={() => exportCsv('suppliers')}>সরবরাহকারী</button>
      </div>
    </div>
  );
}

function SecuritySection(): React.ReactElement {
  const { fail, notify } = useApp();
  const [f, setF] = useState({ old: '', next: '', confirm: '' });
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    if (f.next.length < 6) { notify('error', 'নতুন পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।'); return; }
    if (f.next !== f.confirm) { notify('error', 'পাসওয়ার্ড মিলছে না।'); return; }
    setBusy(true);
    try {
      await call('auth.changePassword', { oldPassword: f.old, newPassword: f.next });
      notify('success', 'পাসওয়ার্ড পরিবর্তন করা হয়েছে।');
      setF({ old: '', next: '', confirm: '' });
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  };

  return (
    <div>
      <p className="mq-card-title">পাসওয়ার্ড পরিবর্তন</p>
      <div className="mq-form-grid">
        <Field label="বর্তমান পাসওয়ার্ড" required><input className="mq-input" type="password" value={f.old} onChange={(e) => setF({ ...f, old: e.target.value })} /></Field>
        <div />
        <Field label="নতুন পাসওয়ার্ড" required><input className="mq-input" type="password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} /></Field>
        <Field label="নিশ্চিত করুন" required><input className="mq-input" type="password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} /></Field>
      </div>
      <button className="mq-btn primary mq-mt" onClick={submit} disabled={busy}>পরিবর্তন করুন</button>
      <div className="mq-alert info mq-mt"><Lock /> পাসওয়ার্ড নিরাপদে হ্যাশ করে সংরক্ষণ করা হয়। ১৫ মিনিট নিষ্ক্রিয় থাকলে অ্যাপ স্বয়ংক্রিয়ভাবে লক হয়।</div>
    </div>
  );
}

function SystemSection(): React.ReactElement {
  const { fail, notify } = useApp();
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const support = useSetting('support_contact');

  useEffect(() => {
    (async () => {
      try {
        const h = await call<Record<string, unknown>>('system.health');
        setHealth(h);
      } catch (e) { fail(e); }
    })();
  }, [fail]);

  if (!health) return <Spinner />;

  const counts = health.counts as Record<string, number>;
  const last = health.lastBackup as { created_at: string } | null;

  return (
    <div>
      <p className="mq-card-title">সিস্টেম অবস্থা</p>
      <div className="mq-grid cols-2">
        <div className="mq-list-row"><span>ডাটাবেস</span><strong style={{ marginLeft: 'auto' }}>{health.dbOk ? '✅ সুস্থ' : '❌ সমস্যা'}</strong></div>
        <div className="mq-list-row"><span>ডাটাবেস সাইজ</span><strong style={{ marginLeft: 'auto' }}>{(Number(health.dbSize) / 1024).toFixed(1)} KB</strong></div>
        <div className="mq-list-row"><span>শেষ ব্যাকআপ</span><strong style={{ marginLeft: 'auto' }}>{last ? new Date(last.created_at).toLocaleString('bn-BD') : 'কখনো নেওয়া হয়নি'}</strong></div>
        <div className="mq-list-row"><span>পণ্য / বিক্রয় / কাস্টমার</span><strong style={{ marginLeft: 'auto' }}>{counts?.products} / {counts?.sales} / {counts?.customers}</strong></div>
      </div>
      {!health.dbOk && <div className="mq-alert error mq-mt">ডাটাবেসে সমস্যা ধরা পড়েছে। দ্রুত ব্যাকআপ নিয়ে সাপোর্টের সাথে যোগাযোগ করুন।</div>}
      <hr className="mq-divider" />
      <p className="mq-card-title">সাপোর্ট তথ্য</p>
      <div className="mq-flex">
        <input className="mq-input" value={support.value} onChange={(e) => support.setValue(e.target.value)} placeholder="যেমন: হটলাইন 09XXXXXXXXX" style={{ flex: 1 }} />
        <button className="mq-btn" onClick={support.save}>সংরক্ষণ</button>
      </div>
      <hr className="mq-divider" />
      <div className="mq-empty" style={{ padding: '20px' }}>
        <div className="mq-brand-mark" style={{ margin: '0 auto' }}>M</div>
        <p className="mq-empty-title" style={{ marginTop: 10 }}>MERQO Retail Suite</p>
        <p className="mq-empty-sub">সংস্করণ 1.0.0 • © ২০২৬ MERQO. সর্বস্বত্ব সংরক্ষিত।<br />অফলাইন-ফার্স্ট • বাংলা • লাইট মোড</p>
        <button className="mq-btn sm ghost" onClick={() => notify('success', 'MERQO Retail Suite v1.0.0 — প্রোডাকশন বিল্ড')}>বিল্ড তথ্য</button>
      </div>
    </div>
  );
}

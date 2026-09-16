import React, { useState } from 'react';
import { Store, Banknote, Receipt, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { call } from '../api';
import { useApp } from '../store';
import { Field } from '../components/ui';
import { toPaisa } from '@shared/money';
import type { Session } from '@shared/types';

const STEPS = [
  { id: 0, label: 'ব্যবসার তথ্য', icon: <Store /> },
  { id: 1, label: 'প্রারম্ভিক ব্যালেন্স', icon: <Banknote /> },
  { id: 2, label: 'ইনভয়েস সেটআপ', icon: <Receipt /> },
  { id: 3, label: 'অ্যাডমিন নিরাপত্তা', icon: <ShieldCheck /> },
  { id: 4, label: 'সম্পন্ন', icon: <CheckCircle2 /> },
];

export function SetupWizard(): React.ReactElement {
  const { notify, fail, setSetupComplete, refreshMe } = useApp();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [biz, setBiz] = useState({ name: '', owner_name: '', phone: '', address: '', business_type: 'মুদি দোকান', email: '' });
  const [opening, setOpening] = useState({ CASH: '', BANK: '', BKASH: '', NAGAD: '', ROCKET: '', UPAY: '' });
  const [inv, setInv] = useState({ prefix: 'MERQO', footer: 'ধন্যবাদ! আবার আসবেন।', terms: '' });
  const [admin, setAdmin] = useState({ name: '', username: '', password: '', confirm: '', phone: '' });
  const [error, setError] = useState('');

  const next = (): void => { setError(''); setStep((s) => Math.min(4, s + 1)); };
  const back = (): void => { setError(''); setStep((s) => Math.max(0, s - 1)); };

  const validateStep = (): boolean => {
    if (step === 0 && !biz.name.trim()) { setError('ব্যবসার নাম আবশ্যক।'); return false; }
    if (step === 3) {
      if (!admin.name.trim() || !admin.username.trim()) { setError('অ্যাডমিনের নাম ও ইউজারনাম আবশ্যক।'); return false; }
      if (admin.password.length < 6) { setError('পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।'); return false; }
      if (admin.password !== admin.confirm) { setError('পাসওয়ার্ড মিলছে না। আবার যাচাই করুন।'); return false; }
    }
    return true;
  };

  const finish = async (): Promise<void> => {
    if (!validateStep()) return;
    setBusy(true);
    setError('');
    try {
      const balances: Record<string, number> = {};
      for (const [k, v] of Object.entries(opening)) {
        if (v.trim()) balances[k] = toPaisa(v);
      }
      await call<Session>('setup.run', {
        payload: {
          business: biz,
          openingBalances: balances,
          admin: { name: admin.name.trim(), username: admin.username.trim(), password: admin.password, phone: admin.phone.trim() || undefined },
          invoice: inv,
        },
      }, { noAuth: true });
      notify('success', 'সেটআপ সম্পন্ন হয়েছে। এখন লগইন করুন।');
      setSetupComplete(true);
      await refreshMe();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mq-wizard">
      <div className="mq-wizard-card">
        <div className="mq-wizard-head">
          <div className="mq-brand-mark" style={{ margin: '0 auto' }}>M</div>
          <h2 style={{ margin: '10px 0 2px' }}>MERQO Retail Suite সেটআপ</h2>
          <p className="mq-muted" style={{ margin: 0 }}>{STEPS[step].label} — ধাপ {step + 1} / 5</p>
        </div>
        <div className="mq-wizard-steps">
          {STEPS.map((s) => <div key={s.id} className={`mq-wizard-step${s.id <= step ? ' done' : ''}`} />)}
        </div>
        <div className="mq-wizard-body">
          {step === 0 && (
            <div className="mq-form-grid">
              <Field label="ব্যবসার নাম" required><input className="mq-input" value={biz.name} onChange={(e) => setBiz({ ...biz, name: e.target.value })} placeholder="যেমন: মেসার্স রহমান স্টোর" autoFocus /></Field>
              <Field label="মালিকের নাম"><input className="mq-input" value={biz.owner_name} onChange={(e) => setBiz({ ...biz, owner_name: e.target.value })} placeholder="যেমন: মোঃ রহমান" /></Field>
              <Field label="মোবাইল"><input className="mq-input" value={biz.phone} onChange={(e) => setBiz({ ...biz, phone: e.target.value })} placeholder="01XXXXXXXXX" /></Field>
              <Field label="ইমেইল"><input className="mq-input" value={biz.email} onChange={(e) => setBiz({ ...biz, email: e.target.value })} placeholder="you@shop.com" /></Field>
              <Field label="ঠিকানা"><input className="mq-input" value={biz.address} onChange={(e) => setBiz({ ...biz, address: e.target.value })} placeholder="দোকান নং, বাজার, এলাকা" /></Field>
              <Field label="ব্যবসার ধরন">
                <select className="mq-select" value={biz.business_type} onChange={(e) => setBiz({ ...biz, business_type: e.target.value })}>
                  {['মুদি দোকান', 'সুপার শপ', 'মিনি মার্ট', 'জেনারেল স্টোর', 'কনভেনিয়েন্স স্টোর', 'ফার্মেসি', 'অন্যান্য'].map((t) => <option key={t}>{t}</option>)}
                </select>
              </Field>
              <div className="mq-alert info" style={{ gridColumn: '1 / -1' }}>মুদ্রা: <strong>৳ বাংলাদেশি টাকা</strong> — পরবর্তীতে সেটিংস থেকে বিস্তারিত পরিবর্তন করা যাবে।</div>
            </div>
          )}
          {step === 1 && (
            <>
              <p className="mq-muted" style={{ marginTop: 0 }}>বর্তমানে প্রতিটি হিসাবে কত টাকা আছে লিখুন। ফাঁকা রাখলে শূন্য ধরা হবে।</p>
              <div className="mq-form-grid cols-3">
                {([['CASH', 'হাতে নগদ'], ['BANK', 'ব্যাংক'], ['BKASH', 'বিকাশ'], ['NAGAD', 'নগদ'], ['ROCKET', 'রকেট'], ['UPAY', 'উপায়']] as const).map(([code, label]) => (
                  <Field key={code} label={label}>
                    <input className="mq-input" inputMode="decimal" value={opening[code]} onChange={(e) => setOpening({ ...opening, [code]: e.target.value })} placeholder="৳০" />
                  </Field>
                ))}
              </div>
              <div className="mq-alert info" style={{ marginTop: 14 }}>পণ্যের স্টক, কাস্টমারের বকেয়া ও সরবরাহকারীর দেনা সেটআপের পর সংশ্লিষ্ট মেনু বা ইমপোর্ট থেকে যোগ করা যাবে।</div>
            </>
          )}
          {step === 2 && (
            <div className="mq-form-grid">
              <Field label="ইনভয়েস প্রিফিক্স" hint="ইনভয়েস নম্বর হবে যেমন: MERQO-2026-000001">
                <input className="mq-input" value={inv.prefix} onChange={(e) => setInv({ ...inv, prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} maxLength={10} />
              </Field>
              <div />
              <Field label="ইনভয়েস ফুটার" hint="রসিদের নিচে দেখাবে">
                <input className="mq-input" value={inv.footer} onChange={(e) => setInv({ ...inv, footer: e.target.value })} />
              </Field>
              <Field label="শর্তাবলি (ঐচ্ছিক)">
                <input className="mq-input" value={inv.terms} onChange={(e) => setInv({ ...inv, terms: e.target.value })} placeholder="যেমন: বিক্রীত পণ্য ফেরতযোগ্য নয়" />
              </Field>
              <div className="mq-alert info" style={{ gridColumn: '1 / -1' }}>প্রিন্টার সেটআপ বিক্রয় পেজ থেকে যেকোনো সময় করা যাবে। থার্মাল (৫৮/৮০মিমি), A4 ও PDF সমর্থিত।</div>
            </div>
          )}
          {step === 3 && (
            <div className="mq-form-grid">
              <Field label="আপনার নাম" required><input className="mq-input" value={admin.name} onChange={(e) => setAdmin({ ...admin, name: e.target.value })} placeholder="পুরো নাম" /></Field>
              <Field label="মোবাইল"><input className="mq-input" value={admin.phone} onChange={(e) => setAdmin({ ...admin, phone: e.target.value })} placeholder="01XXXXXXXXX" /></Field>
              <Field label="ইউজারনাম" required><input className="mq-input" value={admin.username} onChange={(e) => setAdmin({ ...admin, username: e.target.value })} placeholder="যেমন: admin" autoComplete="username" /></Field>
              <div />
              <Field label="পাসওয়ার্ড" required hint="কমপক্ষে ৬ অক্ষর"><input className="mq-input" type="password" value={admin.password} onChange={(e) => setAdmin({ ...admin, password: e.target.value })} autoComplete="new-password" /></Field>
              <Field label="পাসওয়ার্ড নিশ্চিত করুন" required><input className="mq-input" type="password" value={admin.confirm} onChange={(e) => setAdmin({ ...admin, confirm: e.target.value })} autoComplete="new-password" /></Field>
              <div className="mq-alert info" style={{ gridColumn: '1 / -1' }}>এই অ্যাকাউন্টটি মালিক (Owner) হিসেবে তৈরি হবে। ব্যাকআপ সেটিংস পরে <strong>সেটিংস → ব্যাকআপ</strong> থেকে করা যাবে।</div>
            </div>
          )}
          {step === 4 && (
            <div className="mq-empty">
              <div className="mq-empty-icon" style={{ background: 'var(--mq-green-soft)' }}><CheckCircle2 color="var(--mq-green)" /></div>
              <p className="mq-empty-title">সব প্রস্তুত!</p>
              <p className="mq-empty-sub">“সেটআপ সম্পন্ন করুন” চাপ দিলে আপনার ব্যবসা তৈরি হয়ে যাবে।</p>
            </div>
          )}
          {error && <div className="mq-alert error" style={{ marginTop: 14 }}>{error}</div>}
        </div>
        <div className="mq-wizard-foot">
          <button className="mq-btn" onClick={back} disabled={step === 0 || busy}>পেছনে</button>
          {step < 4
            ? <button className="mq-btn primary" onClick={() => { if (validateStep()) next(); }}>পরবর্তী</button>
            : <button className="mq-btn success" onClick={finish} disabled={busy}>{busy ? 'তৈরি হচ্ছে…' : 'সেটআপ সম্পন্ন করুন'}</button>}
        </div>
      </div>
    </div>
  );
}

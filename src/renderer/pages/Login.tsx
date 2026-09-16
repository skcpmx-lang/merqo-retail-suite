import React, { useState } from 'react';
import { Zap, ShieldCheck, Receipt, BarChart3, LogIn } from 'lucide-react';
import { useApp } from '../store';
import { ApiError } from '../api';
import { bnError } from '@shared/bn';
import { Field } from '../components/ui';

export function Login(): React.ReactElement {
  const { login, notify } = useApp();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError('ইউজারনাম ও পাসওয়ার্ড দিন।');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await login(username.trim(), password);
      notify('success', 'স্বাগতম! সফলভাবে লগইন হয়েছে।');
    } catch (err) {
      setError(err instanceof ApiError ? bnError(err.code) : 'লগইন করা যায়নি।');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mq-login">
      <div className="mq-login-left">
        <div className="mq-brand-mark" style={{ width: 52, height: 52, fontSize: 28 }}>M</div>
        <h1>MERQO.</h1>
        <p>আপনার দোকানের সম্পূর্ণ হিসাব — বিক্রয়, স্টক, বকেয়া, খরচ ও লাভ — এখন একটি অ্যাপেই। সম্পূর্ণ অফলাইনে, নিরাপদে।</p>
        <div className="mq-login-feats">
          <div className="mq-login-feat"><Zap /> দ্রুত POS — বারকোড স্ক্যানার সমর্থিত</div>
          <div className="mq-login-feat"><Receipt /> ইনভয়েস, রসিদ ও থার্মাল প্রিন্ট</div>
          <div className="mq-login-feat"><BarChart3 /> লাভ-ক্ষতি, বকেয়া ও স্টক রিপোর্ট</div>
          <div className="mq-login-feat"><ShieldCheck /> ইন্টারনেট ছাড়াই ১০০% অফলাইন</div>
        </div>
      </div>
      <div className="mq-login-right">
        <form className="mq-login-card" onSubmit={submit}>
          <h2 style={{ margin: '0 0 4px', fontSize: 22 }}>লগইন করুন</h2>
          <p className="mq-muted" style={{ margin: '0 0 20px' }}>আপনার অ্যাকাউন্ট দিয়ে প্রবেশ করুন</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="ইউজারনাম" required>
              <input className="mq-input" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="যেমন: admin" autoComplete="username" autoFocus />
            </Field>
            <Field label="পাসওয়ার্ড" required>
              <input className="mq-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
            </Field>
            {error && <div className="mq-alert error">{error}</div>}
            <button className="mq-btn primary lg block" disabled={busy}>
              <LogIn /> {busy ? 'প্রবেশ করা হচ্ছে…' : 'প্রবেশ করুন'}
            </button>
            <p className="mq-small mq-muted" style={{ textAlign: 'center', margin: 0 }}>
              ১৫ মিনিট নিষ্ক্রিয় থাকলে অ্যাপ স্বয়ংক্রিয়ভাবে লক হয়ে যাবে।
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}

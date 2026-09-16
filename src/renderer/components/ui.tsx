import React, { useEffect, useRef, useState } from 'react';
import { Inbox, X } from 'lucide-react';

/* ---------- Modal ---------- */
export function Modal({ title, sub, onClose, children, footer, size }: {
  title: string; sub?: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode; size?: 'lg' | 'xl';
}): React.ReactElement {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="mq-modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`mq-modal${size ? ' ' + size : ''}`} role="dialog" aria-modal="true">
        <div className="mq-modal-head">
          <div style={{ flex: 1 }}>
            <h3 className="mq-modal-title">{title}</h3>
            {sub && <p className="mq-modal-sub">{sub}</p>}
          </div>
          <button className="mq-icon-btn" onClick={onClose} aria-label="বন্ধ করুন" style={{ width: 32, height: 32 }}>
            <X />
          </button>
        </div>
        <div className="mq-modal-body">{children}</div>
        {footer && <div className="mq-modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/* ---------- Confirm dialog with consequences ---------- */
export function Confirm({ title, message, consequences, confirmLabel, danger, onCancel, onConfirm, busy }: {
  title: string; message: string; consequences?: string[]; confirmLabel?: string; danger?: boolean;
  onCancel: () => void; onConfirm: () => void; busy?: boolean;
}): React.ReactElement {
  return (
    <Modal title={title} onClose={onCancel} footer={(
      <>
        <button className="mq-btn" onClick={onCancel} disabled={busy}>বাতিল করুন</button>
        <button className={`mq-btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm} disabled={busy}>
          {busy ? 'অপেক্ষা করুন…' : confirmLabel || 'চালিয়ে যান'}
        </button>
      </>
    )}>
      <p style={{ margin: '0 0 10px' }}>{message}</p>
      {consequences && consequences.length > 0 && (
        <ul style={{ margin: '0 0 4px', paddingLeft: 20, color: 'var(--mq-text-2)', fontSize: 13 }}>
          {consequences.map((c, i) => <li key={i}>{c}</li>)}
        </ul>
      )}
    </Modal>
  );
}

/* ---------- Empty state ---------- */
export function EmptyState({ icon, title, sub, action }: {
  icon?: React.ReactNode; title: string; sub?: string; action?: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="mq-empty">
      <div className="mq-empty-icon">{icon || <Inbox />}</div>
      <p className="mq-empty-title">{title}</p>
      {sub && <p className="mq-empty-sub">{sub}</p>}
      {action}
    </div>
  );
}

/* ---------- Page header ---------- */
export function PageHeader({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }): React.ReactElement {
  return (
    <div className="mq-pagehead">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      <div className="spacer" />
      {children}
    </div>
  );
}

/* ---------- Badge ---------- */
export function Badge({ tone, children }: { tone: 'green' | 'amber' | 'red' | 'blue' | 'gray' | 'teal' | 'violet'; children: React.ReactNode }): React.ReactElement {
  return <span className={`mq-badge ${tone}`}>{children}</span>;
}

export function paymentBadge(status: string): React.ReactElement {
  if (status === 'PAID') return <Badge tone="green">পরিশোধিত</Badge>;
  if (status === 'PARTIAL') return <Badge tone="amber">আংশিক</Badge>;
  if (status === 'DUE') return <Badge tone="red">বকেয়া</Badge>;
  return <Badge tone="gray">{status}</Badge>;
}

/* ---------- Form controls ---------- */
export function Field({ label, required, error, hint, children }: {
  label: string; required?: boolean; error?: string; hint?: string; children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="mq-field">
      <label>{label}{required && <span className="req">*</span>}</label>
      {children}
      {error && <span className="mq-field-err">{error}</span>}
      {hint && !error && <span className="mq-field-hint">{hint}</span>}
    </div>
  );
}

/* ---------- Pagination ---------- */
export function Pagination({ page, pageSize, total, onChange }: {
  page: number; pageSize: number; total: number; onChange: (page: number) => void;
}): React.ReactElement {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="mq-pagination">
      <span>মোট {total}টির মধ্যে {from}–{to} দেখানো হচ্ছে</span>
      <div className="spacer" />
      <button className="mq-btn sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>আগের</button>
      <span>পৃষ্ঠা {page} / {pages}</span>
      <button className="mq-btn sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>পরের</button>
    </div>
  );
}

/* ---------- Spinner ---------- */
export function Spinner(): React.ReactElement {
  return <div className="mq-spinner" />;
}

/* ---------- Hooks ---------- */
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

export function useOnMount(fn: () => void): void {
  const ref = useRef(false);
  useEffect(() => {
    if (ref.current) return;
    ref.current = true;
    fn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

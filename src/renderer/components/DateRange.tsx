import React, { useMemo, useState } from 'react';
import { DatePreset, DateRange as DR, resolvePreset, rangeToUtcBounds, todayYMD } from '@shared/dates';

const PRESETS: { id: DatePreset; label: string }[] = [
  { id: 'today', label: 'আজ' },
  { id: 'last7', label: 'গত ৭ দিন' },
  { id: 'thisMonth', label: 'এই মাস' },
  { id: 'last3months', label: 'গত ৩ মাস' },
  { id: 'last6months', label: 'গত ৬ মাস' },
  { id: 'thisYear', label: 'এই বছর' },
  { id: 'custom', label: 'কাস্টম' },
];

export interface RangeValue extends DR {
  fromUtc: string;
  toUtc: string;
}

export function useDateRange(initial: DatePreset = 'thisMonth'): { range: RangeValue; setPreset: (p: DatePreset) => void; setCustom: (from: string, to: string) => void; RangePicker: () => React.ReactElement } {
  const [preset, setPreset] = useState<DatePreset>(initial);
  const [custom, setCustomState] = useState(() => {
    const t = todayYMD();
    return { from: t, to: t };
  });

  const range: RangeValue = useMemo(() => {
    const r = resolvePreset(preset, 'Asia/Dhaka', new Date(), custom);
    const { fromUtc, toUtc } = rangeToUtcBounds(r, 'Asia/Dhaka');
    return { ...r, fromUtc, toUtc };
  }, [preset, custom]);

  const setCustom = (from: string, to: string): void => {
    setCustomState({ from, to });
    setPreset('custom');
  };

  const RangePicker = (): React.ReactElement => (
    <div className="mq-flex mq-wrap" style={{ gap: 8 }}>
      <div className="mq-segment" role="tablist" aria-label="তারিখ সীমা">
        {PRESETS.map((p) => (
          <button key={p.id} className={preset === p.id ? 'active' : ''} onClick={() => setPreset(p.id)}>{p.label}</button>
        ))}
      </div>
      {preset === 'custom' && (
        <div className="mq-flex" style={{ gap: 6 }}>
          <input type="date" className="mq-input" style={{ width: 150 }} value={custom.from} max={custom.to} onChange={(e) => setCustom(e.target.value, custom.to)} />
          <span className="mq-muted">থেকে</span>
          <input type="date" className="mq-input" style={{ width: 150 }} value={custom.to} min={custom.from} onChange={(e) => setCustom(custom.from, e.target.value)} />
        </div>
      )}
      <span className="mq-small mq-muted">{range.from} → {range.to}</span>
    </div>
  );

  return { range, setPreset, setCustom, RangePicker };
}

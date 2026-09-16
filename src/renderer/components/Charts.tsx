import React, { useMemo } from 'react';

/** Lightweight dependency-free SVG charts (offline, no external libs). */

function niceMax(v: number): number {
  if (v <= 0) return 10;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10;
  return m * pow;
}

export function LineChart({ data, height = 200, color = '#0e63b6', formatY }: {
  data: { label: string; value: number }[]; height?: number; color?: string; formatY?: (v: number) => string;
}): React.ReactElement {
  const W = 600;
  const H = height;
  const padL = 8;
  const padB = 22;
  const padT = 10;
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const pts = useMemo(() => {
    if (!data.length) return '';
    const step = (W - padL * 2) / Math.max(1, data.length - 1);
    return data.map((d, i) => {
      const x = padL + i * step;
      const y = padT + (H - padT - padB) * (1 - d.value / max);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  }, [data, max, H]);
  const area = pts ? `${padL},${H - padB} ${pts} ${W - padL},${H - padB}` : '';
  const last = data[data.length - 1];
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="চার্ট">
        {[0.25, 0.5, 0.75, 1].map((f) => {
          const y = padT + (H - padT - padB) * (1 - f);
          return <line key={f} x1={padL} x2={W - padL} y1={y} y2={y} stroke="#e8edf4" strokeWidth={1} />;
        })}
        {area && <polygon points={area} fill={color} opacity={0.10} />}
        {pts && <polyline points={pts} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />}
        {data.map((d, i) => {
          if (data.length > 12 && i % Math.ceil(data.length / 6) !== 0 && i !== data.length - 1) return null;
          const step = (W - padL * 2) / Math.max(1, data.length - 1);
          const x = padL + i * step;
          return <text key={i} x={x} y={H - 6} fontSize={10} fill="#7b8aa0" textAnchor="middle">{d.label.slice(5)}</text>;
        })}
      </svg>
      {last && formatY && (
        <div className="mq-flex" style={{ justifyContent: 'space-between' }}>
          <span className="mq-small mq-muted">সর্বোচ্চ স্কেল: {formatY(max)}</span>
          <span className="mq-small" style={{ fontWeight: 800 }}>সর্বশেষ: {formatY(last.value)}</span>
        </div>
      )}
    </div>
  );
}

export function BarChart({ data, height = 200, color = '#0e63b6', formatY }: {
  data: { label: string; value: number }[]; height?: number; color?: string; formatY?: (v: number) => string;
}): React.ReactElement {
  const W = 600;
  const H = height;
  const padB = 22;
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const n = Math.max(1, data.length);
  const bw = Math.min(46, ((W - 16) / n) * 0.55);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="বার চার্ট">
        {[0.5, 1].map((f) => {
          const y = 8 + (H - 8 - padB) * (1 - f);
          return <line key={f} x1={8} x2={W - 8} y1={y} y2={y} stroke="#e8edf4" strokeWidth={1} />;
        })}
        {data.map((d, i) => {
          const slot = (W - 16) / n;
          const x = 8 + i * slot + (slot - bw) / 2;
          const h = Math.max(2, (H - 8 - padB) * (d.value / max));
          const y = H - padB - h;
          return (
            <g key={i}>
              <rect x={x} y={y} width={bw} height={h} rx={4} fill={color} opacity={0.9}>
                <title>{`${d.label}: ${formatY ? formatY(d.value) : d.value}`}</title>
              </rect>
              {(n <= 10 || i % Math.ceil(n / 8) === 0) && (
                <text x={x + bw / 2} y={H - 6} fontSize={10} fill="#7b8aa0" textAnchor="middle">{d.label.length > 8 ? d.label.slice(0, 7) + '…' : d.label}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

const DONUT_COLORS = ['#0e63b6', '#12805c', '#9a6200', '#5b5bd6', '#0e7490', '#c0362c', '#6b7280'];

export function DonutChart({ data, size = 180, formatV }: {
  data: { label: string; value: number }[]; size?: number; formatV?: (v: number) => string;
}): React.ReactElement {
  const total = data.reduce((a, d) => a + d.value, 0) || 1;
  const R = 60;
  const C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="mq-flex" style={{ gap: 16, alignItems: 'center' }}>
      <svg width={size} height={size} viewBox="0 0 150 150" role="img" aria-label="ডোনাট চার্ট">
        <circle cx={75} cy={75} r={R} fill="none" stroke="#eef1f7" strokeWidth={22} />
        {data.map((d, i) => {
          const frac = d.value / total;
          const dash = frac * C;
          const off = acc * C;
          acc += frac;
          return (
            <circle
              key={i} cx={75} cy={75} r={R} fill="none"
              stroke={DONUT_COLORS[i % DONUT_COLORS.length]} strokeWidth={22}
              strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={-off}
              transform="rotate(-90 75 75)"
            >
              <title>{`${d.label}: ${formatV ? formatV(d.value) : d.value}`}</title>
            </circle>
          );
        })}
        <text x={75} y={72} textAnchor="middle" fontSize={15} fontWeight={800} fill="#16233a">{formatV ? formatV(total) : total}</text>
        <text x={75} y={90} textAnchor="middle" fontSize={11} fill="#7b8aa0">মোট</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {data.map((d, i) => (
          <div key={i} className="mq-small" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <i style={{ display: 'inline-block', width: 11, height: 11, borderRadius: 3, background: DONUT_COLORS[i % DONUT_COLORS.length] }} />
            <span>{d.label}</span>
            <strong style={{ marginLeft: 'auto' }}>{formatV ? formatV(d.value) : d.value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

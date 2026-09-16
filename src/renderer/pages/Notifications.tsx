import React, { useCallback, useEffect, useState } from 'react';
import { Bell, BellOff, CheckCheck, AlertTriangle, Info, AlertOctagon } from 'lucide-react';
import { Layout } from '../components/Layout';
import { PageHeader, EmptyState, Pagination, Spinner, Badge } from '../components/ui';
import { call } from '../api';
import { useApp } from '../store';
import type { NotificationRow, Paged } from '@shared/types';

export function Notifications(): React.ReactElement {
  const { fail, notify } = useApp();
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<NotificationRow> & { unread?: number }>({ rows: [], total: 0, page: 1, pageSize: 50 });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await call<Paged<NotificationRow> & { unread?: number }>('notif.list', { opts: { unreadOnly, page, pageSize: 50 } });
      setData(r);
    } catch (e) { fail(e); }
    finally { setLoading(false); }
  }, [unreadOnly, page, fail]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [unreadOnly]);

  const icon = (p: string): React.ReactElement => {
    if (p === 'critical') return <AlertOctagon color="var(--mq-red)" />;
    if (p === 'warning') return <AlertTriangle color="var(--mq-amber)" />;
    return <Info color="var(--mq-accent)" />;
  };

  const tone = (p: string): 'red' | 'amber' | 'blue' => (p === 'critical' ? 'red' : p === 'warning' ? 'amber' : 'blue');
  const label = (p: string): string => (p === 'critical' ? 'জরুরি' : p === 'warning' ? 'সতর্কতা' : 'তথ্য');

  return (
    <Layout title="নোটিফিকেশন" sub={`${data.unread ?? 0}টি অপঠিত`}>
      <PageHeader title="নোটিফিকেশন" sub="স্টক, বকেয়া, মেয়াদ ও সিস্টেম সতর্কতা">
        <div className="mq-segment">
          <button className={!unreadOnly ? 'active' : ''} onClick={() => setUnreadOnly(false)}>সব</button>
          <button className={unreadOnly ? 'active' : ''} onClick={() => setUnreadOnly(true)}>অপঠিত</button>
        </div>
        <button className="mq-btn" onClick={async () => {
          try { await call('notif.readAll'); notify('success', 'সব নোটিফিকেশন পড়া হয়েছে।'); load(); } catch (e) { fail(e); }
        }}><CheckCheck /> সব পড়া হয়েছে</button>
      </PageHeader>
      {loading ? <Spinner /> : data.rows.length === 0 ? (
        <div className="mq-card"><EmptyState icon={<BellOff />} title="কোনো নোটিফিকেশন নেই" sub="সব ঠিকঠাক চলছে।" /></div>
      ) : (
        <div className="mq-card">
          {data.rows.map((n) => (
            <div key={n.id} className="mq-list-row" style={{ background: n.read_at ? undefined : 'var(--mq-accent-soft)', alignItems: 'flex-start' }}>
              <div className="mq-empty-icon" style={{ width: 40, height: 40, margin: 0 }}>{icon(n.priority)}</div>
              <div style={{ flex: 1 }}>
                <div className="mq-flex" style={{ gap: 8 }}>
                  <strong>{n.title}</strong>
                  <Badge tone={tone(n.priority)}>{label(n.priority)}</Badge>
                </div>
                <div style={{ fontSize: 13.5 }}>{n.message}</div>
                <div className="mq-small mq-muted">{new Date(n.created_at).toLocaleString('bn-BD')}</div>
              </div>
              {!n.read_at && <button className="mq-btn sm ghost" onClick={async () => { try { await call('notif.read', { id: n.id }); load(); } catch (e) { fail(e); } }}><Bell /> পড়েছি</button>}
            </div>
          ))}
        </div>
      )}
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
    </Layout>
  );
}

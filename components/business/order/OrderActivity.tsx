'use client';

import { useEffect, useRef, useState } from 'react';
import { loadOrderActivity } from '@/actions/order-activity';
import type { OrderActivityPage } from '@/lib/order/activity-presentation';
import type { LogChangeRow } from '@/lib/order/log-format';
import { Button } from '@/components/ui/button';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import styles from './OrderActivity.module.css';

function Changes({ rows }: { rows: LogChangeRow[] }) {
  return <dl className={styles.changes}>{rows.map(row => <div key={row.field}>
    <dt>{row.label}</dt><dd><span>{row.before}</span><span aria-label="变更为">→</span><strong>{row.after}</strong></dd>
  </div>)}</dl>;
}

export function OrderActivity({ orderId, initialPage }: { orderId: string; initialPage: OrderActivityPage }) {
  const [page, setPage] = useState(initialPage);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const loading = useRef(false);
  const moreButton = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const restoreListFocus = useRef(false);
  useEffect(() => {
    if (restoreListFocus.current) { list.current?.focus({ preventScroll: true }); restoreListFocus.current = false; }
  }, [page]);
  async function loadMore() {
    if (!page.nextCursor || loading.current) return;
    const hadFocus = document.activeElement === moreButton.current;
    loading.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await loadOrderActivity({ orderId, cursor: page.nextCursor });
      if (!result.ok) { setError(result.message); return; }
      const existing = new Set(page.events.map(event => event.id));
      const added = result.page.events.filter(event => !existing.has(event.id));
      setPage({ events: [...page.events, ...added], nextCursor: result.page.nextCursor });
      setNotice(`已加载 ${added.length} 条更早记录`);
      // Preserve keyboard position when the final page removes the load button.
      restoreListFocus.current = !result.page.nextCursor && hadFocus && (document.activeElement === document.body || document.activeElement === moreButton.current);
    } catch {
      setError('加载失败，请重试');
    } finally { loading.current = false; setPending(false); }
  }
  return <section className={styles.activity} aria-label="操作事件">
    <p className={styles.count}>已显示 {page.events.length} 条</p>
    {page.events.length === 0 ? <p className={styles.count}>暂无动态</p> : null}
    <ol ref={list} tabIndex={-1} aria-label="工单事件记录">
      {page.events.map((event, index) => <li key={event.id}>
        {index === 0 || event.date !== page.events[index - 1]?.date ? <h3 className={styles.date}>{event.date}</h3> : null}
        <article className={styles.event}>
          <header><h4>{event.title}</h4><p><time dateTime={event.at}>{event.time}</time><span>{event.actor}</span></p></header>
          <Changes rows={event.changes.primary} />
          {event.remark ? <p className={styles.remark}>{event.remark}</p> : null}
          {event.changes.details.length || event.changes.unavailable ? <Disclosure className={styles.details}>
            <DisclosureSummary>查看变更详情<span className={styles.indicator} aria-hidden="true">⌄</span></DisclosureSummary>
            <Changes rows={event.changes.details} />
            {event.changes.unavailable ? <p className={styles.count}>部分历史变更详情暂无法展示</p> : null}
          </Disclosure> : null}
        </article>
      </li>)}
    </ol>
    <p role="status" className="sr-only">{notice}</p>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    {page.nextCursor ? <Button ref={moreButton} variant="outline" disabled={pending} onClick={loadMore}>{pending ? '正在加载…' : error ? '重试加载' : '加载更早记录'}</Button> : null}
  </section>;
}

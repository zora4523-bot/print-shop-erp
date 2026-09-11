'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  BookOpen,
  Calculator,
  Copy,
  MessageCircle,
  Plus,
  Search,
} from 'lucide-react';
import type { ExternalCreateOrderOptions } from '@/lib/order/create-order-options';
import { parseCatalogPaperWeight } from '@/lib/order/catalog-pricing-facts';
import {
  SALES_SCENARIOS,
  PAPER_GUIDE,
  QUOTE_GUIDE,
} from '@/lib/workbench/knowledge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Disclosure, DisclosureSummary } from '@/components/ui/disclosure';
import { Input } from '@/components/ui/input';
import {
  ActionNotice,
  EmptyState,
  PageHeader,
  useCopyToClipboard,
} from '@/components/ui-business';
import { WorkbenchCalculator } from './WorkbenchCalculator';

export function SalesWorkbench({
  options,
  catalogUnavailable = false,
}: {
  options: ExternalCreateOrderOptions;
  catalogUnavailable?: boolean;
}) {
  const [section, setSection] = useState('quote');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('全部');
  const { copy, feedback, reset } = useCopyToClipboard();
  const query = search.trim().toLocaleLowerCase('zh-CN');
  const scenarios = SALES_SCENARIOS.filter(
    (item) =>
      (category === '全部' || category === item.category) &&
      Object.values(item).join(' ').toLocaleLowerCase('zh-CN').includes(query),
  );
  const categories = [
    '全部',
    ...new Set(SALES_SCENARIOS.map((item) => item.category)),
  ];
  return (
    <div className="mx-auto max-w-7xl space-y-4" data-testid="sales-workbench">
      <div className="flex flex-col gap-2 rounded-xl border bg-card p-2 sm:flex-row sm:items-center">
        <PageHeader title="工作台" className="sr-only" />
        <nav
          aria-label="工作台分区"
          className="grid min-w-0 flex-1 grid-cols-3 gap-2"
        >
          {[
            { value: 'quote', label: '报价计算', icon: Calculator },
            { value: 'materials', label: '纸张与规格', icon: BookOpen },
            { value: 'sales', label: '话术应对', icon: MessageCircle },
          ].map(({ value, label, icon: Icon }) => (
            <Button
              key={value}
              type="button"
              variant={section === value ? 'default' : 'ghost'}
              className="min-h-11 whitespace-normal px-2"
              aria-pressed={section === value}
              onClick={() => {
                setSection(value);
                reset();
              }}
            >
              <Icon aria-hidden className="hidden size-4 sm:block" />
              {label}
            </Button>
          ))}
        </nav>
        <Link
          href="/orders/new"
          prefetch={false}
          className={buttonVariants({
            variant: 'outline',
            className: 'min-h-11 shrink-0 self-end sm:self-auto',
          })}
        >
          <Plus aria-hidden className="size-4" />
          创建工单
        </Link>
      </div>
      <section
        hidden={section !== 'quote'}
        aria-label="报价计算"
        className="space-y-4"
      >
        {catalogUnavailable ? (
          <ActionNotice
            tone="error"
            title="产品资料暂无法加载"
            description="刷新页面重试，或先查看销售资料"
            action={
              <Button
                className="min-h-11"
                variant="outline"
                onClick={() => window.location.reload()}
              >
                重新加载
              </Button>
            }
          />
        ) : (
          <WorkbenchCalculator options={options} />
        )}
        <Card className="p-4 sm:p-6">
          <h2 className="text-lg font-semibold">计算方式</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {QUOTE_GUIDE.map(([title, content]) => (
              <div key={title}>
                <h3 className="mb-2 text-sm font-semibold">{title}</h3>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {content}
                </p>
              </div>
            ))}
          </div>
        </Card>
      </section>
      <section
        hidden={section !== 'materials'}
        aria-label="纸张与规格"
        className="space-y-6"
      >
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">当前可选规格</h2>
          {catalogUnavailable ? (
            <ActionNotice
              tone="error"
              title="规格资料暂无法加载，请刷新页面重试"
            />
          ) : !options.specifications.length ? (
            <EmptyState
              title="暂无规格"
              description="请联系管理员配置产品规格"
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {options.specifications.map((spec) => (
                <Card key={spec.specCode} className="p-4">
                  <h3 className="font-semibold">{spec.label}</h3>
                  <p className="text-sm text-muted-foreground">
                    {spec.widthMm !== null && spec.heightMm !== null
                      ? `${spec.widthMm} × ${spec.heightMm} mm`
                      : '尺寸待确认'}
                  </p>
                </Card>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">当前纸张目录</h2>
          {catalogUnavailable ? (
            <ActionNotice
              tone="error"
              title="纸张资料暂无法加载，请刷新页面重试"
            />
          ) : !options.papers.length ? (
            <EmptyState title="暂无纸张" />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {options.papers.map((paper) => (
                <Card key={paper.id} className="p-4">
                  <h3 className="font-semibold">{paper.name}</h3>
                  <p className="text-sm text-muted-foreground">
                    {paper.specification || '规格待确认'}
                    {paper.weight !== null &&
                    parseCatalogPaperWeight(paper.specification) !== paper.weight
                      ? ` · ${paper.weight}g`
                      : ''}
                  </p>
                  <p className="text-sm">
                    {paper.outOfStock ? '缺货，请确认补货时间' : '交期请确认'}
                  </p>
                </Card>
              ))}
            </div>
          )}
        </div>
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">纸张推荐思路</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {PAPER_GUIDE.map(([name, feature, advice]) => (
              <Card key={name} className="p-4">
                <h3 className="font-semibold">{name}</h3>
                <p className="text-sm text-primary">{feature}</p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {advice}
                </p>
              </Card>
            ))}
          </div>
        </div>
      </section>
      <section
        hidden={section !== 'sales'}
        aria-label="话术应对"
        className="space-y-4"
      >
        <div>
          <h2 className="text-lg font-semibold">客户这么说，你这么接</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            先看客户顾虑，再选沟通方式。
          </p>
        </div>
        <div className="relative">
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-3 size-5 text-muted-foreground"
          />
          <Input
            aria-label="搜索销售话术"
            placeholder="搜索价格、纸张、打样、交期…"
            className="min-h-11 pl-10"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2" aria-label="话术分类">
          {categories.map((name) => (
            <Button
              type="button"
              key={name}
              className="min-h-11"
              variant={category === name ? 'secondary' : 'outline'}
              aria-pressed={category === name}
              onClick={() => setCategory(name)}
            >
              {name}
            </Button>
          ))}
        </div>
        <p className="text-sm text-muted-foreground">
          {scenarios.length} 个应对场景
        </p>
        {feedback && (
          <ActionNotice
            tone={feedback.tone === 'error' ? 'error' : 'success'}
            title={feedback.message}
          />
        )}
        {!scenarios.length && (
          <EmptyState
            kind="no-result"
            noun="话术"
            onClear={
              <Button
                className="min-h-11"
                variant="outline"
                onClick={() => {
                  setSearch('');
                  setCategory('全部');
                }}
              >
                清除筛选
              </Button>
            }
          />
        )}
        <div className="space-y-3">
          {scenarios.map((item) => (
            <Disclosure
              key={item.title}
              className="rounded-xl border bg-card p-2 sm:p-3"
            >
              <DisclosureSummary className="gap-3 px-2">
                <span className="min-w-0 flex-1">{item.title}</span>
                <Plus
                  aria-hidden
                  className="size-4 shrink-0 group-open:rotate-45"
                />
              </DisclosureSummary>
              <div className="space-y-4 p-2 pt-4 text-sm leading-relaxed">
                <div>
                  <h3 className="font-semibold">客户顾虑</h3>
                  <p className="mt-1 text-muted-foreground">{item.concern}</p>
                </div>
                <div>
                  <h3 className="font-semibold">应对思路</h3>
                  <p className="mt-1 text-muted-foreground">{item.approach}</p>
                </div>
                <div className="rounded-lg border bg-muted/40 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold">参考话术</h3>
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11"
                      aria-label={`复制话术：${item.title}`}
                      onClick={() => void copy(item.reply, '话术')}
                    >
                      <Copy aria-hidden className="size-4" />
                      复制话术
                    </Button>
                  </div>
                  <p className="mt-3 select-text">{item.reply}</p>
                </div>
                <div>
                  <h3 className="font-semibold">避免这样说</h3>
                  <p className="mt-1 text-muted-foreground">{item.avoid}</p>
                </div>
              </div>
            </Disclosure>
          ))}
        </div>
      </section>
    </div>
  );
}

'use client'

import { Activity, Cpu, Globe, KeyRound, Timer, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Model, Provider, UsageMetrics } from '@/lib/types'
import { formatCompact, MiniBars, Sparkline } from './mini-charts'

const STATUS_STYLES: Record<Model['status'], string> = {
  ready: 'bg-primary',
  loading: 'bg-chart-4 animate-pulse',
  error: 'bg-destructive',
}

const STATUS_LABEL: Record<Model['status'], string> = {
  ready: 'Pronto',
  loading: 'Carregando',
  error: 'Erro',
}

function aggregateUsage(models: Model[]): UsageMetrics {
  const daily = [0, 0, 0, 0, 0, 0, 0]
  let requests = 0
  let tokens = 0
  let latencySum = 0
  let latencyWeight = 0

  for (const m of models) {
    if (!m.usage) continue
    requests += m.usage.requests
    tokens += m.usage.tokens
    latencySum += m.usage.avgLatencyMs * (m.usage.requests || 1)
    latencyWeight += m.usage.requests || 1
    m.usage.daily.forEach((v, i) => {
      daily[i] = (daily[i] ?? 0) + v
    })
  }

  return {
    requests,
    tokens,
    avgLatencyMs: latencyWeight ? Math.round(latencySum / latencyWeight) : 0,
    daily,
  }
}

export function ProviderCard({ provider }: { provider: Provider }) {
  const isLocal = provider.type === 'local'
  const usage = aggregateUsage(provider.models)
  const accent = isLocal ? 'var(--primary)' : 'var(--chart-2)'

  return (
    <section className="flex flex-col rounded-xl border border-border bg-card">
      {/* Header */}
      <header className="flex items-center justify-between gap-2 px-3 py-2.5">
        <div className="flex min-w-0 items-center gap-2.5">
          <div
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-lg ring-1',
              isLocal
                ? 'bg-primary/15 text-primary ring-primary/30'
                : 'bg-chart-2/15 text-chart-2 ring-chart-2/30',
            )}
          >
            {isLocal ? (
              <Cpu className="size-4" aria-hidden="true" />
            ) : (
              <Globe className="size-4" aria-hidden="true" />
            )}
          </div>
          <div className="min-w-0 leading-tight">
            <div className="flex items-center gap-1.5">
              <h3 className="truncate text-sm font-semibold text-card-foreground">
                {provider.name}
              </h3>
              <span
                className={cn(
                  'shrink-0 rounded px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide ring-1',
                  isLocal
                    ? 'bg-primary/10 text-primary ring-primary/30'
                    : 'bg-chart-2/10 text-chart-2 ring-chart-2/30',
                )}
              >
                {isLocal ? 'Local' : 'API'}
              </span>
            </div>
            <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span>
                {provider.models.length}{' '}
                {provider.models.length === 1 ? 'modelo' : 'modelos'}
              </span>
              {provider.type === 'api' && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="flex items-center gap-1">
                    <KeyRound className="size-3" aria-hidden="true" />
                    {provider.hasApiKey ? 'chave ok' : 'sem chave'}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>

        <Sparkline
          data={usage.daily}
          color={accent}
          className="h-8 w-20 shrink-0"
        />
      </header>

      {/* Metrics strip */}
      <div className="grid grid-cols-3 gap-px border-y border-border bg-border">
        <Metric
          icon={<Activity className="size-3" aria-hidden="true" />}
          label="Reqs (7d)"
          value={formatCompact(usage.requests)}
        />
        <Metric
          icon={<Timer className="size-3" aria-hidden="true" />}
          label="Latência"
          value={usage.avgLatencyMs ? `${usage.avgLatencyMs}ms` : '—'}
        />
        <Metric
          icon={<Zap className="size-3" aria-hidden="true" />}
          label="Tokens"
          value={formatCompact(usage.tokens)}
        />
      </div>

      {/* Models */}
      <ul className="flex flex-col divide-y divide-border">
        {provider.models.length === 0 && (
          <li className="px-3 py-5 text-center text-xs text-muted-foreground">
            Nenhum modelo cadastrado
          </li>
        )}
        {provider.models.map((model) => (
          <li key={model.id} className="flex items-center gap-3 px-3 py-2">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'size-1.5 shrink-0 rounded-full',
                    STATUS_STYLES[model.status],
                  )}
                  title={STATUS_LABEL[model.status]}
                  aria-hidden="true"
                />
                <span className="truncate font-mono text-xs text-foreground">
                  {model.name}
                </span>
              </div>
              <div className="flex items-center gap-1.5 pl-3.5">
                {model.kind && <Tag>{model.kind}</Tag>}
                {model.context && <Tag>{model.context}</Tag>}
                {model.size && <Tag>{model.size}</Tag>}
                {model.usage && model.usage.requests > 0 && (
                  <span className="text-[10px] text-muted-foreground">
                    {formatCompact(model.usage.requests)} reqs ·{' '}
                    {model.usage.avgLatencyMs}ms
                  </span>
                )}
              </div>
            </div>
            <MiniBars
              data={model.usage?.daily ?? [0, 0, 0, 0, 0, 0, 0]}
              color={accent}
              className="w-16 shrink-0"
            />
          </li>
        ))}
      </ul>
    </section>
  )
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode
  label: string
  value: string
}) {
  return (
    <div className="flex flex-col gap-0.5 bg-card px-3 py-2">
      <span className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="font-mono text-sm font-semibold text-foreground">
        {value}
      </span>
    </div>
  )
}

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded border border-border bg-secondary px-1.5 py-px text-[10px] font-medium text-muted-foreground">
      {children}
    </span>
  )
}

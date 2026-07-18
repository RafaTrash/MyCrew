'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { Activity, Boxes, Plus, RefreshCw, Loader2, Server, Timer, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CreateModelPayload, Provider } from '@/lib/types'
import { ProviderCard } from './provider-card'
import { AddModelDialog } from './add-model-dialog'
import { ConfigureProviderDialog } from './configure-provider-dialog'
import { formatCompact } from './mini-charts'
import { useAuth } from '@/lib/auth-context'
import { useToast } from './ui/toaster'

interface ModelsResponse {
  providers: Provider[]
  totalModels: number
}

interface SyncResponse extends ModelsResponse {
  synced: number
}

function computeSummary(providers: Provider[]) {
  let requests = 0
  let tokens = 0
  let latencySum = 0
  let latencyWeight = 0
  let activeModels = 0

  const perProvider = providers.map((p) => {
    let pReq = 0
    for (const m of p.models) {
      if (m.status === 'ready') activeModels += 1
      if (!m.usage) continue
      requests += m.usage.requests
      pReq += m.usage.requests
      tokens += m.usage.tokens
      latencySum += m.usage.avgLatencyMs * (m.usage.requests || 1)
      latencyWeight += m.usage.requests || 1
    }
    return { name: p.name, type: p.type, requests: pReq }
  })

  return {
    requests,
    tokens,
    avgLatencyMs: latencyWeight ? Math.round(latencySum / latencyWeight) : 0,
    activeModels,
    perProvider,
  }
}

export function ModelsView() {
  const { user, token } = useAuth()
  const { toast } = useToast()
  
  const { data, isLoading, isValidating, mutate, error } = useSWR<ModelsResponse>(
    token ? ['/api/models'] : null,
    (url: string) => fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    }).then((r) => {
      if (r.status === 401) {
        // Token expired or invalid, redirect to login
        window.location.href = '/login'
        throw new Error('Unauthorized')
      }
      return r.json()
    }),
    { revalidateOnFocus: false }
  )
  
  const [modelDialogOpen, setModelDialogOpen] = useState(false)
  const [configureDialogOpen, setConfigureDialogOpen] = useState(false)
  const [syncing, setSyncing] = useState(false)

  const providers = data?.providers ?? []
  const totalModels = data?.totalModels ?? 0
  const summary = computeSummary(providers)
  const maxProviderReqs = Math.max(
    1,
    ...summary.perProvider.map((p) => p.requests),
  )

  async function handleSubmitModel(payload: CreateModelPayload) {
    const res = await fetch('/api/models', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error ?? 'Falha ao salvar o modelo.')
    }
    await mutate()
  }

  async function handleSubmitProviderConfig(slug: string, payload: { baseUrl?: string; apiKey?: string }) {
    const res = await fetch(`/api/providers/${slug}/configure`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error ?? 'Falha ao configurar o provedor.')
    }
    await mutate()
  }

  async function handleSync() {
    setSyncing(true)
    try {
      const res = await fetch('/api/models/sync', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast(`Erro: ${body.error ?? 'Falha na sincronização'}`, 'error')
      } else {
        const data = await res.json()
        toast(`Sincronizado com sucesso! ${data.synced ?? 0} modelos encontrados.`, 'success')
      }
      await mutate()
    } catch (err) {
      toast(`Erro de conexão: ${err instanceof Error ? err.message : 'Tente novamente'}`, 'error')
      await mutate()
    } finally {
      setSyncing(false)
    }
  }

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!user && !isLoading) {
      window.location.href = '/login'
    }
  }, [user, isLoading])

  if (!user && !isLoading) {
    return null
  }

  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-border bg-card/40 p-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-foreground">
              Modelos disponíveis
            </h2>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {totalModels}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Modelos locais (Ollama) e provedores externos via API. Configure os provedores antes de adicionar modelos.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSync}
            disabled={syncing || isValidating || !token}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-60"
          >
            <RefreshCw
              className={cn('size-4', (syncing || isValidating) && 'animate-spin')}
            />
            {syncing ? 'Sincronizando...' : 'Atualizar'}
          </button>
          <button
            type="button"
            onClick={() => setConfigureDialogOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            <Plus className="size-4" />
            Configurar provedor
          </button>
          <button
            type="button"
            onClick={() => setModelDialogOpen(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Plus className="size-4" />
            Adicionar modelo
          </button>
        </div>
      </div>

      {/* Summary */}
      {!isLoading && providers.length > 0 && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-4">
          <StatCard
            icon={<Server className="size-4" aria-hidden="true" />}
            label="Provedores"
            value={String(providers.length)}
            hint={`${summary.activeModels} modelos ativos`}
          />
          <StatCard
            icon={<Activity className="size-4" aria-hidden="true" />}
            label="Requisições (7d)"
            value={formatCompact(summary.requests)}
            hint="somando todos os modelos"
          />
          <StatCard
            icon={<Timer className="size-4" aria-hidden="true" />}
            label="Latência média"
            value={summary.avgLatencyMs ? `${summary.avgLatencyMs}ms` : '—'}
            hint="ponderada por requisição"
          />
          <StatCard
            icon={<Zap className="size-4" aria-hidden="true" />}
            label="Tokens (7d)"
            value={formatCompact(summary.tokens)}
            hint="processados no período"
          />
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Carregando modelos...
        </div>
      ) : providers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhum provedor configurado ainda. Configure um provedor para começar.
          </p>
          <div className="mt-3 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setConfigureDialogOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
            >
              <Plus className="size-4" />
              Configurar provedor
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {providers.map((provider) => (
              <ProviderCard key={provider.id} provider={provider} />
            ))}
          </div>

          {/* Consultas por provedor - moved to end of page */}
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="mb-3 flex items-center gap-2">
              <Boxes className="size-4 text-muted-foreground" aria-hidden="true" />
              <h3 className="text-sm font-medium text-foreground">
                Consultas por provedor (7d)
              </h3>
            </div>
            <ul className="flex flex-col gap-2.5">
              {summary.perProvider.map((p) => (
                <li key={p.name} className="flex items-center gap-3">
                  <span className="w-36 shrink-0 truncate text-xs text-muted-foreground">
                    {p.name}
                  </span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-secondary">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        p.type === 'local' ? 'bg-primary' : 'bg-chart-2',
                      )}
                      style={{
                        width: `${(p.requests / maxProviderReqs) * 100}%`,
                      }}
                    />
                  </div>
                  <span className="w-14 shrink-0 text-right font-mono text-xs text-foreground">
                    {formatCompact(p.requests)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      <AddModelDialog
        open={modelDialogOpen}
        onClose={() => setModelDialogOpen(false)}
        onSubmit={handleSubmitModel}
        token={token}
        providers={providers}
      />

      <ConfigureProviderDialog
        open={configureDialogOpen}
        providers={providers}
        onClose={() => setConfigureDialogOpen(false)}
        onSubmit={handleSubmitProviderConfig}
      />
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-border bg-card p-4">
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="font-mono text-2xl font-semibold text-foreground">
        {value}
      </span>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </div>
  )
}
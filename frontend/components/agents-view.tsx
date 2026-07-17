'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import { Bot, Plus, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Agent, Provider } from '@/lib/types'
import { AddAgentDialog } from './add-agent-dialog'
import { useAuth } from '@/lib/auth-context'

interface AgentsResponse {
  agents: Agent[]
  totalAgents: number
}

export function AgentsView() {
  const { user, token } = useAuth()
  
  const { data, isLoading, mutate } = useSWR<AgentsResponse>(
    token ? ['/api/agents'] : null,
    (url: string) => fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    }).then((r) => r.json()),
    { revalidateOnFocus: false }
  )

  const [agentDialogOpen, setAgentDialogOpen] = useState(false)

  const agents = data?.agents ?? []
  const totalAgents = data?.totalAgents ?? 0

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!user && !isLoading) {
      window.location.href = '/login'
    }
  }, [user, isLoading])

  if (!user && !isLoading) {
    return null
  }

  async function handleSubmitAgent(payload: {
    name: string
    description?: string
    avatarUrl?: string
    modelId: string
    modelName?: string
    tags?: string[]
    prompt: string
    skills?: string[]
    knowledge?: string[]
  }) {
    const res = await fetch('/api/agents', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.error ?? 'Falha ao salvar o agente.')
    }
    await mutate()
  }

  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-border bg-card/40 p-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-foreground">
              Agentes cadastrados
            </h2>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {totalAgents}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Agentes virtuais com modelos vinculados e configurações personalizadas.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setAgentDialogOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Plus className="size-4" />
          Adicionar agente
        </button>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Carregando agentes...
        </div>
      ) : agents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhum agente cadastrado ainda. Adicione um agente para começar.
          </p>
          <div className="mt-3 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setAgentDialogOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
            >
              <Plus className="size-4" />
              Adicionar agente
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} />
          ))}
        </div>
      )}

      <AddAgentDialog
        open={agentDialogOpen}
        onClose={() => setAgentDialogOpen(false)}
        onSubmit={handleSubmitAgent}
      />
    </div>
  )
}

function AgentCard({ agent }: { agent: Agent }) {
  const initials = agent.name.trim().slice(0, 2).toUpperCase() || 'AG'
  const isCortex = agent.name.trim().toLowerCase() === 'cortex'
  
  if (isCortex) {
    return (
      <div className="flex flex-col rounded-xl border border-border bg-card p-4">
        <div className="flex items-start gap-3">
          <div
            className="relative size-12 shrink-0"
            aria-hidden="true"
          >
            {/* Outer rotating ring - Cyan/Blue glow */}
            <svg
              className="cortex-outer-ring absolute inset-0 size-full"
              viewBox="0 0 48 48"
            >
              <circle
                cx="24"
                cy="24"
                r="22"
                fill="none"
                stroke="oklch(0.75 0.16 165 / 0.4)"
                strokeWidth="1.5"
                strokeDasharray="3 2"
              />
            </svg>
            
            {/* Inner rotating ring - Brighter blue */}
            <svg
              className="cortex-inner-ring absolute inset-0 size-full"
              viewBox="0 0 48 48"
            >
              <circle
                cx="24"
                cy="24"
                r="16"
                fill="none"
                stroke="oklch(0.75 0.16 165 / 0.6)"
                strokeWidth="1.5"
                strokeDasharray="2 2"
              />
            </svg>
            
            {/* Core avatar with pulse animation */}
            <div className="cortex-avatar-core absolute inset-1 rounded-xl overflow-hidden">
              {/* eslint-disable-next-line @next/no-img-element */}
              <img
                src={agent.avatarUrl || '/cortex/cortex.png'}
                alt=""
                className="size-full object-cover"
              />
            </div>
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                {agent.name}
              </h3>
              {agent.modelName && (
                <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                  {agent.modelName}
                </span>
              )}
            </div>
          </div>
        </div>
        
        {agent.description && (
          <p className="mt-3 text-xs text-muted-foreground line-clamp-2">
            {agent.description}
          </p>
        )}

        {agent.skills && agent.skills.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1">
            {agent.skills.map((skill) => (
              <span
                key={skill}
                className="rounded-md bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground"
              >
                {skill}
              </span>
            ))}
          </div>
        )}

        {agent.tags && agent.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {agent.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-md bg-chart-2/10 px-2 py-0.5 text-[10px] text-chart-2"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
    )
  }
  
  // Default avatar for other agents
  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <div
          className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-chart-2/20 text-base font-semibold text-chart-2 ring-1 ring-chart-2/40"
          aria-hidden="true"
        >
          {agent.avatarUrl ? (
            // eslint-disable-next-line @next/no-img-element
            <img
              src={agent.avatarUrl}
              alt=""
              className="size-full object-cover"
            />
          ) : (
            initials
          )}
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-foreground">
              {agent.name}
            </h3>
            {agent.modelName && (
              <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                {agent.modelName}
              </span>
            )}
          </div>
        </div>
      </div>
      
      {agent.description && (
        <p className="mt-3 text-xs text-muted-foreground line-clamp-2">
          {agent.description}
        </p>
      )}

      {agent.skills && agent.skills.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {agent.skills.map((skill) => (
            <span
              key={skill}
              className="rounded-md bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground"
            >
              {skill}
            </span>
          ))}
        </div>
      )}

      {agent.tags && agent.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {agent.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-md bg-chart-2/10 px-2 py-0.5 text-[10px] text-chart-2"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

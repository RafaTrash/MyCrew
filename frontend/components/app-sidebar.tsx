'use client'

import {
  Bot,
  BrainCircuit,
  LayoutGrid,
  MessageSquare,
  Boxes,
  Workflow,
  Activity,
  Cpu,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const NAV_ITEMS = [
  { label: 'Visão Geral', icon: LayoutGrid, active: false },
  { label: 'Models', icon: BrainCircuit, active: true },
  { label: 'Agents', icon: Bot, active: false },
  { label: 'Chat', icon: MessageSquare, active: false },
  { label: 'Knowledge', icon: Boxes, active: false },
  { label: 'Fluxos n8n', icon: Workflow, active: false },
  { label: 'Monitor', icon: Activity, active: false },
  { label: 'IOTs', icon: Cpu, active: false },
]

export function AppSidebar() {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      {/* Brand */}
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="flex size-10 items-center justify-center rounded-xl bg-chart-2/20 ring-1 ring-chart-2/40">
          <BrainCircuit className="size-5 text-chart-2" aria-hidden="true" />
        </div>
        <div className="leading-tight">
          <p className="text-sm font-semibold tracking-widest text-sidebar-foreground">
            MYCREW
          </p>
          <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
            Control Center
          </p>
        </div>
      </div>

      <div className="mx-5 border-t border-sidebar-border" />

      {/* Navigation */}
      <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          return (
            <a
              key={item.label}
              href="#"
              aria-current={item.active ? 'page' : undefined}
              className={cn(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                item.active
                  ? 'bg-sidebar-accent text-sidebar-foreground ring-1 ring-primary/30'
                  : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-foreground',
              )}
            >
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              {item.label}
            </a>
          )
        })}
      </nav>

      {/* Status */}
      <div className="mx-3 mb-3 rounded-lg border border-sidebar-border bg-sidebar-accent/40 px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span
            className="size-2 rounded-full bg-primary"
            aria-hidden="true"
          />
          <span className="text-xs font-semibold uppercase tracking-wide text-primary">
            Parcial
          </span>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">
          5/10 serviços · 1 modelo
        </p>
      </div>

      {/* User */}
      <div className="flex items-center gap-3 border-t border-sidebar-border px-4 py-3">
        <div className="flex size-8 items-center justify-center rounded-full bg-chart-2/20 text-xs font-semibold text-chart-2">
          R
        </div>
        <div className="leading-tight">
          <p className="text-sm font-medium text-sidebar-foreground">
            Rafael R.
          </p>
          <p className="text-[11px] text-muted-foreground">Administrador</p>
        </div>
      </div>
    </aside>
  )
}

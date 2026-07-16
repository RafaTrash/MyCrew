'use client'

import { Edit, KeyRound, Trash2, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ProviderSummary } from '@/lib/types'

interface ProvidersTableProps {
  providers: ProviderSummary[]
  onEdit: (provider: ProviderSummary) => void
  onDelete: (provider: ProviderSummary) => void
}

export function ProvidersTable({ providers, onEdit, onDelete }: ProvidersTableProps) {
  return (
    <div className="rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Nome</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Slug</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Base URL</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">API Key</th>
            <th className="px-4 py-3 text-left font-medium text-muted-foreground">Modelos</th>
            <th className="px-4 py-3 text-right font-medium text-muted-foreground">Ações</th>
          </tr>
        </thead>
        <tbody>
          {providers
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((provider) => (
              <tr key={provider.id} className="border-b border-border last:border-0">
                <td className="px-4 py-3 font-medium text-foreground">{provider.name}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{provider.slug}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted-foreground truncate max-w-[200px]">
                  {provider.baseUrl || '—'}
                </td>
                <td className="px-4 py-3">
                  {provider.hasApiKey ? (
                    <span className="flex items-center gap-1 text-xs text-primary">
                      <KeyRound className="size-3" />
                      Configurada
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {provider.modelCount ?? 0}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => onEdit(provider)}
                      className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      title="Editar"
                    >
                      <Edit className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(provider)}
                      className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-destructive/15 hover:text-destructive"
                      title="Excluir"
                      disabled={provider.slug === 'ollama'}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  )
}
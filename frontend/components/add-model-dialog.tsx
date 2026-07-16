'use client'

import { useEffect, useState } from 'react'
import { Loader2, Server, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CreateModelPayload, ProviderSummary } from '@/lib/types'

interface AddModelDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (payload: CreateModelPayload) => Promise<void>
}

export function AddModelDialog({ open, onClose, onSubmit }: AddModelDialogProps) {
  const [providers, setProviders] = useState<ProviderSummary[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [modelName, setModelName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingProviders, setLoadingProviders] = useState(false)

  useEffect(() => {
    if (open) {
      setSelectedProviderId('')
      setModelName('')
      setError(null)
      loadProviders()
    }
  }, [open])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (open) document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  async function loadProviders() {
    setLoadingProviders(true)
    try {
      const res = await fetch('/api/providers')
      if (res.ok) {
        const data = await res.json()
        setProviders(data.providers || [])
      }
    } catch {
      // Silently fail, providers list will be empty
    } finally {
      setLoadingProviders(false)
    }
  }

  if (!open) return null

  const selectedProvider = providers.find((p) => p.id === selectedProviderId)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!selectedProviderId) {
      setError('Selecione um provedor.')
      return
    }
    if (!modelName.trim()) {
      setError('Preencha o nome do modelo.')
      return
    }

    setSubmitting(true)
    try {
      await onSubmit({
        type: 'api',
        providerName: selectedProvider?.name || '',
        providerSlug: selectedProvider?.slug || '',
        modelName: modelName.trim(),
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar o modelo.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-model-title"
    >
      <button
        type="button"
        aria-label="Fechar"
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative z-10 w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <h2
              id="add-model-title"
              className="text-lg font-semibold text-card-foreground"
            >
              Adicionar modelo
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Adicione um modelo a um provedor de API externa já cadastrado.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="size-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          {/* Provedor (dropdown) */}
          <Field label="Provedor" htmlFor="providerSelect">
            {loadingProviders ? (
              <div className="flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Carregando provedores...
              </div>
            ) : providers.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border bg-background px-3 py-2 text-sm text-muted-foreground">
                Nenhum provedor cadastrado. Cadastre um provedor primeiro.
              </div>
            ) : (
              <select
                id="providerSelect"
                value={selectedProviderId}
                onChange={(e) => setSelectedProviderId(e.target.value)}
                className={cn(inputClass, 'appearance-none')}
              >
                <option value="">Selecione um provedor...</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} {p.hasApiKey ? '(chave configurada)' : '(sem chave)'}
                  </option>
                ))}
              </select>
            )}
          </Field>

          {/* Nome do modelo */}
          <Field label="Nome do modelo" htmlFor="modelName">
            <input
              id="modelName"
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder="gpt-4o-mini, claude-3-opus..."
              className={cn(inputClass, 'font-mono text-xs')}
              autoComplete="off"
            />
          </Field>

          {error && (
            <p className="rounded-md bg-destructive/15 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="mt-1 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting || providers.length === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {submitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Server className="size-4" />
              )}
              Salvar modelo
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

const inputClass =
  'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/40'

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string
  htmlFor: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="text-sm font-medium text-card-foreground"
      >
        {label}
      </label>
      {children}
    </div>
  )
}
'use client'

import { useEffect, useState } from 'react'
import { Loader2, Server, X, Wifi, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'
import Image from 'next/image'
import type { CreateModelPayload, Provider } from '@/lib/types'
import { hasProviderLogo } from '@/lib/provider-logo'

interface AddModelDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (payload: CreateModelPayload) => Promise<void>
  token?: string | null
}

export function AddModelDialog({ open, onClose, onSubmit, token }: AddModelDialogProps) {
  const [providers, setProviders] = useState<Provider[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [modelName, setModelName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingProviders, setLoadingProviders] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error'>('idle')

  useEffect(() => {
    if (open) {
      setSelectedProviderId('')
      setModelName('')
      setError(null)
      setConnectionStatus('idle')
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

  async function handleTestConnection() {
    if (!selectedProvider || !selectedProvider.slug) return
    
    // Only test connection for configured API providers
    const providerInList = providers.find(p => p.id === selectedProviderId)
    if (!providerInList || providerInList.type !== 'api' || !providerInList.hasApiKey) return

    setTestingConnection(true)
    setConnectionStatus('idle')
    setError(null)

    try {
      const res = await fetch(`/api/providers/${selectedProvider.slug}/test-connection`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      
      if (res.ok) {
        setConnectionStatus('success')
      } else {
        const body = await res.json().catch(() => ({}))
        setConnectionStatus('error')
        setError(body.error || 'Falha ao testar conexão')
      }
    } catch (err) {
      setConnectionStatus('error')
      setError(err instanceof Error ? err.message : 'Erro de conexão')
    } finally {
      setTestingConnection(false)
    }
  }

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

    // Check if user has configured this provider (for API providers only)
    // Local providers (like Ollama) don't require prior configuration
    const providerInList = providers.find(p => p.id === selectedProviderId)
    if (providerInList && providerInList.type === 'api' && !providerInList.hasApiKey) {
      setError(`Configure o provedor '${providerInList.name}' antes de adicionar modelos.`)
      return
    }

    setSubmitting(true)
    try {
      await onSubmit({
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

  // Show test button only for configured API providers
  const showTestButton = selectedProvider?.type === 'api' && selectedProvider.hasApiKey

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
              Adicione um modelo a um provedor já configurado.
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
                Nenhum provedor disponível. Configure um provedor primeiro.
              </div>
            ) : (
              <div className="relative">
                {selectedProvider && hasProviderLogo(selectedProvider.slug || '') && (
                  <div className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none">
                    <Image
                      src={`/providers/${selectedProvider.slug}.svg`}
                      alt={`${selectedProvider.slug} logo`}
                      width={16}
                      height={16}
                      className={cn('size-4', 'dark:brightness-0 dark:invert')}
                    />
                  </div>
                )}
                <select
                  id="providerSelect"
                  value={selectedProviderId}
                  onChange={(e) => setSelectedProviderId(e.target.value)}
                  className={cn(
                    inputClass,
                    'appearance-none',
                    selectedProvider && hasProviderLogo(selectedProvider.slug || '') && 'pl-7'
                  )}
                >
                  <option value="">Selecione um provedor...</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.hasApiKey ? '(configurado)' : '(não configurado)'}
                    </option>
                  ))}
                </select>
              </div>
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
            {showTestButton && (
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={testingConnection}
                className={cn(
                  'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-60',
                  connectionStatus === 'success'
                    ? 'bg-success/20 text-success hover:bg-success/30'
                    : connectionStatus === 'error'
                    ? 'bg-destructive/20 text-destructive hover:bg-destructive/30'
                    : 'border border-border bg-background text-foreground hover:bg-accent'
                )}
              >
                {testingConnection ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : connectionStatus === 'success' ? (
                  <Wifi className="size-4" />
                ) : connectionStatus === 'error' ? (
                  <WifiOff className="size-4" />
                ) : (
                  <Wifi className="size-4" />
                )}
                {testingConnection ? 'Testando...' : connectionStatus === 'success' ? 'Conectado' : 'Testar Conexão'}
              </button>
            )}
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
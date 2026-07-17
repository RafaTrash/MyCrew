'use client'

import { useEffect, useState } from 'react'
import { Loader2, Server, X, Wifi, WifiOff, RefreshCw } from 'lucide-react'
import { cn } from '@/lib/utils'
import Image from 'next/image'
import type { CreateModelPayload, Provider } from '@/lib/types'
import { hasProviderLogo } from '@/lib/provider-logo'

interface AvailableModel {
  id: string
  name: string
  description?: string
  context?: string
}

interface AddModelDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (payload: CreateModelPayload) => Promise<void>
  token?: string | null
  providers?: Provider[]
}

export function AddModelDialog({ open, onClose, onSubmit, token, providers = [] }: AddModelDialogProps) {
  const [selectedProviderId, setSelectedProviderId] = useState('')
  const [modelName, setModelName] = useState('')
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([])
  const [loadingModels, setLoadingModels] = useState(false)
  const [showModelDropdown, setShowModelDropdown] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testingConnection, setTestingConnection] = useState(false)
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'success' | 'error' | 'model_not_found'>('idle')

  useEffect(() => {
    if (open) {
      setSelectedProviderId('')
      setModelName('')
      setAvailableModels([])
      setShowModelDropdown(false)
      setError(null)
      setConnectionStatus('idle')
    }
  }, [open])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (open) document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Buscar modelos quando um provider API é selecionado
  useEffect(() => {
    async function fetchModels() {
      if (!selectedProviderId) {
        setAvailableModels([])
        return
      }
      
      const provider = providers.find(p => p.id === selectedProviderId)
      if (!provider || !provider.slug || provider.type !== 'api' || !provider.hasApiKey) {
        setAvailableModels([])
        return
      }

      setLoadingModels(true)
      try {
        const res = await fetch(`/api/providers/${provider.slug}/models`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
        if (res.ok) {
          const data = await res.json()
          setAvailableModels(data.models || [])
          setShowModelDropdown(data.models && data.models.length > 0)
        }
      } catch {
        // Silently fail - keep input field
      } finally {
        setLoadingModels(false)
      }
    }
    fetchModels()
  }, [selectedProviderId, providers, token])

  if (!open) return null

  const selectedProvider = providers.find((p) => p.id === selectedProviderId)

  async function handleTestConnection() {
    if (!selectedProviderId) return
    
    const providerForTest = providers.find(p => p.id === selectedProviderId)
    if (!providerForTest) {
      setError('Provedor não encontrado')
      return
    }
    
    if (!providerForTest.slug) {
      setError('Provedor não possui slug configurado')
      return
    }
    
    if (providerForTest.type !== 'api' || !providerForTest.hasApiKey) return

    setTestingConnection(true)
    setConnectionStatus('idle')
    setError(null)

    try {
      // Build URL with optional modelName query param
      const url = modelName.trim() 
        ? `/api/providers/${providerForTest.slug}/test-connection?modelName=${encodeURIComponent(modelName.trim())}`
        : `/api/providers/${providerForTest.slug}/test-connection`
      
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      
      const body = await res.json().catch(() => ({}))
      
      if (res.ok) {
        if (modelName.trim() && body.modelFound === false) {
          setConnectionStatus('model_not_found')
          setError('Modelo não encontrado nesse provedor')
        } else {
          setConnectionStatus('success')
        }
      } else {
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

    const providerForSubmit = providers.find(p => p.id === selectedProviderId)
    if (!providerForSubmit) {
      setError('Provedor não encontrado')
      return
    }

    if (providerForSubmit.type === 'api' && !providerForSubmit.hasApiKey) {
      setError(`Configure o provedor '${providerForSubmit.name}' antes de adicionar modelos.`)
      return
    }

    setSubmitting(true)
    try {
      await onSubmit({
        providerSlug: providerForSubmit.slug || '',
        modelName: modelName.trim(),
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar o modelo.')
    } finally {
      setSubmitting(false)
    }
  }

  const showTestButton = selectedProvider?.type === 'api' && selectedProvider?.hasApiKey

  // Texto do botão de teste baseado no status
  function getTestButtonText() {
    if (testingConnection) return 'Testando...'
    if (connectionStatus === 'success') return modelName.trim() ? 'Conectado ✓' : 'Conectado'
    if (connectionStatus === 'model_not_found') return 'Modelo não encontrado'
    if (connectionStatus === 'error') return 'Erro'
    return 'Testar Conexão'
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
            {providers.length === 0 ? (
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

          {/* Nome do modelo - input or dropdown */}
          <Field label="Nome do modelo" htmlFor="modelName">
            {showModelDropdown && availableModels.length > 0 ? (
              <div className="relative">
                <select
                  id="modelName"
                  value={modelName}
                  onChange={(e) => setModelName(e.target.value)}
                  className={cn(inputClass, 'appearance-none')}
                >
                  <option value="">Selecione um modelo...</option>
                  {availableModels.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
                {loadingModels && (
                  <div className="absolute right-2 top-1/2 -translate-y-1/2">
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  </div>
                )}
              </div>
            ) : (
              <input
                id="modelName"
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder="gpt-4o-mini, claude-3-opus..."
                className={cn(inputClass, 'font-mono text-xs')}
                autoComplete="off"
              />
            )}
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
                    : connectionStatus === 'model_not_found'
                    ? 'bg-warning/20 text-warning hover:bg-warning/30'
                    : connectionStatus === 'error'
                    ? 'bg-destructive/20 text-destructive hover:bg-destructive/30'
                    : 'border border-border bg-background text-foreground hover:bg-accent'
                )}
              >
                {testingConnection ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : connectionStatus === 'success' ? (
                  <Wifi className="size-4" />
                ) : connectionStatus === 'model_not_found' ? (
                  <RefreshCw className="size-4" />
                ) : connectionStatus === 'error' ? (
                  <WifiOff className="size-4" />
                ) : (
                  <Wifi className="size-4" />
                )}
                {getTestButtonText()}
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

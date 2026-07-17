'use client'

import { useState, useEffect } from 'react'
import { Eye, EyeOff, Loader2, KeyRound, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Provider, ProviderConfigPayload } from '@/lib/types'
import Image from 'next/image'
import { hasProviderLogo } from '@/lib/provider-logo'

interface ConfigureProviderDialogProps {
  open: boolean
  providers: Provider[]
  onClose: () => void
  onSubmit: (slug: string, payload: ProviderConfigPayload) => Promise<void>
}

// Hook to fetch all provider templates
function useAllProviders() {
  const [allProviders, setAllProviders] = useState<Provider[]>([])
  
  useEffect(() => {
    fetch('/api/providers')
      .then(r => r.json())
      .then(data => setAllProviders(data.providers || []))
      .catch(() => setAllProviders([]))
  }, [])
  
  return allProviders
}

export function ConfigureProviderDialog({ open, providers, onClose, onSubmit }: ConfigureProviderDialogProps) {
  // Get ALL provider templates (not just configured ones)
  const allTemplates = useAllProviders()
  const [selectedProvider, setSelectedProvider] = useState<Provider | null>(null)
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setSelectedProvider(null)
      setBaseUrl('')
      setApiKey('')
      setShowKey(false)
      setError(null)
    }
  }, [open])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    if (open) document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const config = selectedProvider?.config || {}
  const requiresBaseUrl = Boolean(config.requires_base_url)
  const requiresApiKey = Boolean(config.requires_api_key)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!selectedProvider) {
      setError('Selecione um provedor.')
      return
    }

    if (requiresBaseUrl && !baseUrl.trim()) {
      setError('Preencha a URL base.')
      return
    }
    if (requiresApiKey && !apiKey.trim()) {
      setError('Preencha a API Key.')
      return
    }

    setSubmitting(true)
    try {
      await onSubmit(selectedProvider.slug || '', {
        baseUrl: baseUrl.trim() || undefined,
        apiKey: apiKey.trim() || undefined,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao configurar o provedor.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="configure-provider-title"
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
              id="configure-provider-title"
              className="text-lg font-semibold text-card-foreground"
            >
              Configurar provedor
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Selecione um provedor e configure sua API key.
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
          {/* Provider selection dropdown */}
          <Field label="Provedor" htmlFor="providerSelect">
            <div className="relative">
              {selectedProvider && hasProviderLogo(selectedProvider.slug || '') && (
                <div className="absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none">
                  <Image
                    src={`/providers/${selectedProvider.slug}.svg`}
                    alt={`${selectedProvider.slug} logo`}
                    width={16}
                    height={16}
                    className="size-4"
                  />
                </div>
              )}
              <select
                id="providerSelect"
                value={selectedProvider?.id || ''}
                onChange={(e) => {
                  const provider = allTemplates.find(p => p.id === e.target.value)
                  setSelectedProvider(provider || null)
                }}
                className={cn(
                  inputClass,
                  'appearance-none',
                  selectedProvider && hasProviderLogo(selectedProvider.slug || '') && 'pl-7'
                )}
                disabled={submitting}
              >
                <option value="">Selecione um provedor...</option>
                {allTemplates.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </Field>

          {/* Base URL (if required) */}
          {selectedProvider && requiresBaseUrl && (
            <Field label="URL Base" htmlFor="providerBaseUrl">
              <input
                id="providerBaseUrl"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.exemplo.com/v1"
                className={cn(inputClass, 'font-mono text-xs')}
                autoComplete="off"
                disabled={submitting}
              />
            </Field>
          )}

          {/* API Key (if required) */}
          {selectedProvider && requiresApiKey && (
            <Field label="API Key" htmlFor="providerApiKey">
              <div className="relative">
                <input
                  id="providerApiKey"
                  type={showKey ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  className={cn(inputClass, 'pr-10 font-mono text-xs')}
                  autoComplete="off"
                  disabled={submitting}
                />
                <button
                  type="button"
                  onClick={() => setShowKey((v) => !v)}
                  aria-label={showKey ? 'Ocultar chave' : 'Mostrar chave'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground"
                >
                  {showKey ? (
                    <EyeOff className="size-4" />
                  ) : (
                    <Eye className="size-4" />
                  )}
                </button>
              </div>
            </Field>
          )}

          {error && (
            <p className="rounded-md bg-destructive/15 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}

          <div className="mt-1 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={submitting || !selectedProvider}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {submitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <KeyRound className="size-4" />
              )}
              Salvar configuração
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
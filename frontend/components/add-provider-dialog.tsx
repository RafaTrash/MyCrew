'use client'

import { useState, useEffect } from 'react'
import { Eye, EyeOff, Loader2, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AddProviderDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (payload: {
    name: string
    type: 'api'
    slug: string
    baseUrl: string
    apiKey: string
  }) => Promise<void>
}

export function AddProviderDialog({ open, onClose, onSubmit }: AddProviderDialogProps) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName('')
      setSlug('')
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

  function handleNameChange(value: string) {
    setName(value)
    // Auto-generate slug from name if user hasn't manually edited the slug
    if (!slug || slug === name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')) {
      setSlug(value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''))
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError('Preencha o nome do provedor.')
      return
    }
    if (!slug.trim()) {
      setError('Preencha o slug do provedor.')
      return
    }
    if (!baseUrl.trim()) {
      setError('Preencha a URL base da API.')
      return
    }
    if (!apiKey.trim()) {
      setError('Provedores via API exigem uma chave de API.')
      return
    }

    setSubmitting(true)
    try {
      await onSubmit({
        name: name.trim(),
        type: 'api',
        slug: slug.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar o provedor.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-provider-title"
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
              id="add-provider-title"
              className="text-lg font-semibold text-card-foreground"
            >
              Adicionar provedor
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Cadastre um provedor de API externa para gerenciar seus modelos.
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
          {/* Nome */}
          <Field label="Nome do provedor" htmlFor="providerName">
            <input
              id="providerName"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="Ex: OpenAI, Anthropic, Mistral..."
              className={inputClass}
              autoComplete="off"
            />
          </Field>

          {/* Slug */}
          <Field label="Slug" htmlFor="providerSlug">
            <input
              id="providerSlug"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="openai, anthropic, mistral..."
              className={cn(inputClass, 'font-mono text-xs')}
              autoComplete="off"
            />
          </Field>

          {/* Base URL */}
          <Field label="Base URL" htmlFor="providerBaseUrl">
            <input
              id="providerBaseUrl"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className={cn(inputClass, 'font-mono text-xs')}
              autoComplete="off"
            />
          </Field>

          {/* API Key */}
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
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {submitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Plus className="size-4" />
              )}
              Salvar provedor
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
  optional,
  children,
}: {
  label: string
  htmlFor: string
  optional?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={htmlFor}
        className="flex items-center gap-2 text-sm font-medium text-card-foreground"
      >
        {label}
        {optional && (
          <span className="text-xs font-normal text-muted-foreground">
            (opcional)
          </span>
        )}
      </label>
      {children}
    </div>
  )
}
'use client'

import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { Bot, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CreateAgentPayload, Provider } from '@/lib/types'
import { KNOWLEDGE_OPTIONS, SKILL_OPTIONS } from '@/lib/agent-options'

interface AddAgentDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (payload: CreateAgentPayload) => Promise<void>
}

interface FlatModel {
  id: string
  name: string
  provider: string
}

const fetcher = (url: string) => fetch(url).then((r) => r.json())

export function AddAgentDialog({ open, onClose, onSubmit }: AddAgentDialogProps) {
  const { data } = useSWR<{ providers: Provider[] }>('/api/models', fetcher)

  const models: FlatModel[] = useMemo(() => {
    const list: FlatModel[] = []
    for (const p of data?.providers ?? []) {
      for (const m of p.models) {
        list.push({ id: m.id, name: m.name, provider: p.name })
      }
    }
    return list
  }, [data])

  const [name, setName] = useState('')
  const [avatarUrl, setAvatarUrl] = useState('')
  const [description, setDescription] = useState('')
  const [modelId, setModelId] = useState('')
  const [tags, setTags] = useState<string[]>([])
  const [tagDraft, setTagDraft] = useState('')
  const [skills, setSkills] = useState<string[]>([])
  const [knowledge, setKnowledge] = useState<string[]>([])
  const [prompt, setPrompt] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName('')
      setAvatarUrl('')
      setDescription('')
      setModelId('')
      setTags([])
      setTagDraft('')
      setSkills([])
      setKnowledge([])
      setPrompt('')
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

  function addTag() {
    const value = tagDraft.trim().replace(/,$/, '')
    if (value && !tags.includes(value)) setTags((t) => [...t, value])
    setTagDraft('')
  }

  function toggle(list: string[], value: string): string[] {
    return list.includes(value)
      ? list.filter((v) => v !== value)
      : [...list, value]
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError('Informe o nome do agente.')
      return
    }
    if (!modelId) {
      setError('Selecione o modelo utilizado.')
      return
    }
    if (!prompt.trim()) {
      setError('Escreva o prompt do agente.')
      return
    }

    setSubmitting(true)
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim() || undefined,
        avatarUrl: avatarUrl.trim() || undefined,
        tags,
        prompt: prompt.trim(),
        skills,
        knowledge,
        modelId,
        modelName: models.find((m) => m.id === modelId)?.name,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar o agente.')
    } finally {
      setSubmitting(false)
    }
  }

  const initials = name.trim().slice(0, 2).toUpperCase() || 'AG'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-agent-title"
    >
      <button
        type="button"
        aria-label="Fechar"
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative z-10 flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-start justify-between border-b border-border p-6">
          <div>
            <h2
              id="add-agent-title"
              className="text-lg font-semibold text-card-foreground"
            >
              Adicionar agente
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Configure um agente virtual e vincule um modelo cadastrado.
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

        <form
          onSubmit={handleSubmit}
          className="flex flex-col gap-5 overflow-y-auto p-6"
        >
          {/* Identidade */}
          <div className="flex gap-4">
            <div
              className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-chart-2/20 text-lg font-semibold text-chart-2 ring-1 ring-chart-2/40"
              aria-hidden="true"
            >
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl || '/placeholder.svg'}
                  alt=""
                  className="size-full object-cover"
                />
              ) : (
                initials
              )}
            </div>
            <div className="flex flex-1 flex-col gap-4">
              <Field label="Nome" htmlFor="agentName">
                <input
                  id="agentName"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Assistente de Suporte"
                  className={inputClass}
                  autoComplete="off"
                />
              </Field>
              <Field label="Avatar (URL)" htmlFor="agentAvatar" optional>
                <input
                  id="agentAvatar"
                  value={avatarUrl}
                  onChange={(e) => setAvatarUrl(e.target.value)}
                  placeholder="https://.../avatar.png"
                  className={cn(inputClass, 'font-mono text-xs')}
                  autoComplete="off"
                />
              </Field>
            </div>
          </div>

          {/* Descrição */}
          <Field label="Descrição" htmlFor="agentDesc" optional>
            <textarea
              id="agentDesc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Resumo curto do que este agente faz."
              rows={2}
              className={cn(inputClass, 'resize-none')}
            />
          </Field>

          {/* Modelo */}
          <Field label="Modelo utilizado" htmlFor="agentModel">
            <select
              id="agentModel"
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              className={inputClass}
            >
              <option value="" disabled>
                {models.length ? 'Selecione um modelo' : 'Nenhum modelo cadastrado'}
              </option>
              {models.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} — {m.provider}
                </option>
              ))}
            </select>
          </Field>

          {/* Tags */}
          <Field label="Tags" htmlFor="agentTags" optional>
            <div className={cn(inputClass, 'flex flex-wrap items-center gap-1.5')}>
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-0.5 text-xs text-secondary-foreground"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => setTags((t) => t.filter((x) => x !== tag))}
                    aria-label={`Remover ${tag}`}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              <input
                id="agentTags"
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault()
                    addTag()
                  } else if (e.key === 'Backspace' && !tagDraft && tags.length) {
                    setTags((t) => t.slice(0, -1))
                  }
                }}
                onBlur={addTag}
                placeholder={tags.length ? '' : 'suporte, interno...'}
                className="min-w-[8ch] flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                autoComplete="off"
              />
            </div>
          </Field>

          {/* Skills */}
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-card-foreground">
              Skills
            </legend>
            <div className="flex flex-wrap gap-2">
              {SKILL_OPTIONS.map((s) => {
                const on = skills.includes(s.slug)
                return (
                  <button
                    key={s.slug}
                    type="button"
                    onClick={() => setSkills((prev) => toggle(prev, s.slug))}
                    aria-pressed={on}
                    title={s.description}
                    className={cn(
                      'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                      on
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border bg-background text-muted-foreground hover:border-ring/60',
                    )}
                  >
                    {s.label}
                  </button>
                )
              })}
            </div>
          </fieldset>

          {/* Knowledge */}
          <fieldset>
            <legend className="mb-2 text-sm font-medium text-card-foreground">
              Knowledge
            </legend>
            <div className="flex flex-wrap gap-2">
              {KNOWLEDGE_OPTIONS.map((k) => {
                const on = knowledge.includes(k)
                return (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setKnowledge((prev) => toggle(prev, k))}
                    aria-pressed={on}
                    className={cn(
                      'rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
                      on
                        ? 'border-chart-2 bg-chart-2/10 text-foreground'
                        : 'border-border bg-background text-muted-foreground hover:border-ring/60',
                    )}
                  >
                    {k}
                  </button>
                )
              })}
            </div>
          </fieldset>

          {/* Prompt */}
          <Field label="Prompt (instruções)" htmlFor="agentPrompt">
            <textarea
              id="agentPrompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Você é um assistente especializado em..."
              rows={5}
              className={cn(inputClass, 'resize-y font-mono text-xs leading-relaxed')}
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
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              {submitting ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Bot className="size-4" />
              )}
              Salvar agente
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
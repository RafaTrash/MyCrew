'use client'

import { useEffect, useState } from 'react'
import { Loader2, X, FileText, Upload } from 'lucide-react'
import { cn } from '@/lib/utils'

interface AddKnowledgeDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: (payload: {
    name: string
    description?: string
    file: File
    tags?: string[]
  }) => Promise<void>
}

const ALLOWED_FILE_TYPES = ['.pdf', '.md', '.xlsx', '.csv', '.txt', '.docx', '.pptx']

export function AddKnowledgeDialog({ open, onClose, onSubmit }: AddKnowledgeDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [tagDraft, setTagDraft] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName('')
      setDescription('')
      setFile(null)
      setTags([])
      setTagDraft('')
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

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selectedFile = e.target.files?.[0]
    if (selectedFile) {
      // Verificar extensão do arquivo
      const ext = selectedFile.name.substring(selectedFile.name.lastIndexOf('.')).toLowerCase()
      if (!ALLOWED_FILE_TYPES.includes(ext)) {
        setError(`Tipo de arquivo não suportado. Tipos permitidos: ${ALLOWED_FILE_TYPES.join(', ')}`)
        setFile(null)
        return
      }
      setFile(selectedFile)
      setError(null)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!name.trim()) {
      setError('Informe o nome do documento.')
      return
    }
    if (!file) {
      setError('Selecione um arquivo para fazer upload.')
      return
    }

    setSubmitting(true)
    try {
      await onSubmit({
        name: name.trim(),
        description: description.trim() || undefined,
        file,
        tags,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao salvar o conhecimento.')
    } finally {
      setSubmitting(false)
    }
  }

  const fileExtension = file?.name.substring(file.name.lastIndexOf('.')).toLowerCase() || ''
  const fileIconColor = fileExtension === '.pdf' ? 'text-destructive' : 
                       fileExtension === '.md' ? 'text-primary' :
                       fileExtension === '.xlsx' ? 'text-success' :
                       fileExtension === '.csv' ? 'text-chart-2' : 'text-muted-foreground'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-knowledge-title"
    >
      <button
        type="button"
        aria-label="Fechar"
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative z-10 flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl border border-border bg-card shadow-2xl">
        <div className="flex items-start justify-between border-b border-border p-6">
          <div>
            <h2
              id="add-knowledge-title"
              className="text-lg font-semibold text-card-foreground"
            >
              Adicionar Conhecimento
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Faça upload de um documento e adicione tags para organização.
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
          {/* Nome */}
          <Field label="Nome" htmlFor="knowledgeName">
            <input
              id="knowledgeName"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Manual de Integração API"
              className={inputClass}
              autoComplete="off"
            />
          </Field>

          {/* Descrição */}
          <Field label="Descrição" htmlFor="knowledgeDesc" optional>
            <textarea
              id="knowledgeDesc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Resumo do conteúdo do documento..."
              rows={2}
              className={cn(inputClass, 'resize-none')}
            />
          </Field>

          {/* Upload de Arquivo */}
          <Field label="Arquivo" htmlFor="knowledgeFile">
            <div className="flex flex-col gap-2">
              <div className="relative">
                <input
                  id="knowledgeFile"
                  type="file"
                  accept={ALLOWED_FILE_TYPES.join(',')}
                  onChange={handleFileChange}
                  className="hidden"
                />
                <label
                  htmlFor="knowledgeFile"
                  className={cn(
                    inputClass,
                    'flex cursor-pointer items-center justify-between gap-2 px-3 py-2 hover:bg-accent/50',
                    !file && 'border-dashed'
                  )}
                >
                  <span className={cn(
                    'truncate text-sm',
                    file ? 'text-foreground' : 'text-muted-foreground'
                  )}>
                    {file ? file.name : 'Selecionar arquivo...'}
                  </span>
                  <Upload className="size-4 shrink-0 text-muted-foreground" />
                </label>
              </div>
              {file && (
                <div className="flex items-center gap-2 text-xs">
                  <FileText className={cn('size-3', fileIconColor)} />
                  <span className="text-muted-foreground">
                    {fileExtension.toUpperCase()} • {(file.size / 1024).toFixed(1)} KB
                  </span>
                </div>
              )}
              <p className="text-[10px] text-muted-foreground">
                Tipos suportados: {ALLOWED_FILE_TYPES.join(', ')}
              </p>
            </div>
          </Field>

          {/* Tags */}
          <Field label="Tags" htmlFor="knowledgeTags" optional>
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
                id="knowledgeTags"
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
                placeholder={tags.length ? '' : 'documento, api...'}
                className="min-w-[8ch] flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                autoComplete="off"
              />
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
                <FileText className="size-4" />
              )}
              Salvar conhecimento
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
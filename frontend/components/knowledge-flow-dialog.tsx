'use client'

import { useEffect, useState } from 'react'
import { X, FileText, Upload, Loader2, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Knowledge } from '@/lib/types'
import type { IngestRecommendation, ChunkingStrategyType } from '@/lib/knowledge-types'
import { KnowledgeStepsDiagram } from './knowledge-steps-diagram'
import { useKnowledgeFlow, startKnowledgeIngest, confirmKnowledgeIngest } from '@/lib/use-knowledge-flow'

interface KnowledgeFlowDialogProps {
  open: boolean
  onClose: () => void
  token: string | null
}

const ALLOWED_FILE_TYPES = ['.pdf', '.md', '.xlsx', '.csv', '.txt', '.docx', '.pptx']
const CHUNKING_OPTIONS: { value: ChunkingStrategyType; label: string; description: string }[] = [
  { value: 'fixed_size', label: 'Tamanho Fixo', description: 'Conteúdo desestruturado, sem necessidade de preservar semântica fina' },
  { value: 'sentence', label: 'Sentença', description: 'Preservar unidades de pensamento completas' },
  { value: 'paragraph', label: 'Parágrafo', description: 'Conteúdo já organizado em unidades semânticas' },
  { value: 'sliding_window', label: 'Janela Deslizante', description: 'Manter contexto entre chunks vizinhos' },
  { value: 'recursive', label: 'Recursivo', description: 'Estrutura inconsistente/desconhecida, múltiplas fontes' },
  { value: 'semantic', label: 'Semântico', description: 'Máxima qualidade de recuperação' },
  { value: 'markdown_header', label: 'Markdown Header', description: 'Documentos com headers H1/H2/H3 bem definidos' },
  { value: 'table_aware', label: 'Tabela', description: 'Muitas tabelas intercaladas com texto' },
  { value: 'code_aware', label: 'Código', description: 'Blocos de código-fonte' },
  { value: 'hybrid', label: 'Híbrido', description: 'Documentos com seções de tipos diferentes' },
]

export function KnowledgeFlowDialog({ open, onClose, token }: KnowledgeFlowDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [tags, setTags] = useState<string[]>([])
  const [tagDraft, setTagDraft] = useState('')
  
  const [flowId, setFlowId] = useState<string | null>(null)
  const [showReviewForm, setShowReviewForm] = useState(false)
  const [initialSubmitting, setInitialSubmitting] = useState(false)
  const [confirmSubmitting, setConfirmSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // SSE connection
  const { steps, currentStep, recommendation, isComplete, error: flowError, hasAwaitingConfirmation } = useKnowledgeFlow({
    flowId,
    operation: 'ingest',
    enabled: !!flowId,
  })

  // Form states (para revisão)
  const [chunkSize, setChunkSize] = useState(512)
  const [chunkOverlap, setChunkOverlap] = useState(64)
  const [selectedStrategy, setSelectedStrategy] = useState<ChunkingStrategyType>('paragraph')

  useEffect(() => {
    if (open) {
      setName('')
      setDescription('')
      setFile(null)
      setTags([])
      setTagDraft('')
      setFlowId(null)
      setShowReviewForm(false)
      setError(null)
      setChunkSize(512)
      setChunkOverlap(64)
      setSelectedStrategy('paragraph')
    }
  }, [open])

  // Atualiza form com recommendation quando disponível (via SSE ou fallback API)
  useEffect(() => {
    if (recommendation && !showReviewForm) {
      if (recommendation.operation === 'ingest') {
        setShowReviewForm(true)
        setChunkSize(recommendation.chunking_strategy.parameters.chunk_size)
        setChunkOverlap(recommendation.chunking_strategy.parameters.chunk_overlap)
        setSelectedStrategy(recommendation.chunking_strategy.primary.type)
      }
    }
  }, [recommendation, showReviewForm])

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

  async function handleInitialSubmit(e: React.FormEvent) {
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

    setInitialSubmitting(true)
    try {
      const result = await startKnowledgeIngest(
        { name: name.trim(), description: description.trim() || undefined, file, tags: tags.length ? tags : undefined },
        token
      )
      setFlowId(result.flow_id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao iniciar processamento.')
      setInitialSubmitting(false)
    }
  }

  async function handleConfirmReview() {
    if (!flowId) return
    
    setConfirmSubmitting(true)
    try {
      await confirmKnowledgeIngest({
        flow_id: flowId,
        chunking_strategy: {
          primary: { type: selectedStrategy, reason: 'Reafirmado pelo usuário' },
          parameters: { chunk_size: chunkSize, chunk_overlap: chunkOverlap, separator: '\n\n', min_chunk_size: 100, max_chunk_size: 1024 }
        }
      }, token)
      // Aguarda conclusão via SSE
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao confirmar.')
      setConfirmSubmitting(false)
    }
  }

  const fileExtension = file?.name.substring(file.name.lastIndexOf('.')).toLowerCase() || ''
  const fileIconColor = fileExtension === '.pdf' ? 'text-destructive' : 
                       fileExtension === '.md' ? 'text-primary' :
                       fileExtension === '.xlsx' ? 'text-success' :
                       fileExtension === '.csv' ? 'text-chart-2' : 'text-muted-foreground'

  // Type guard para garantir que recommendation é IngestRecommendation
  const isRecommendation = (rec: typeof recommendation): rec is IngestRecommendation => 
    rec?.operation === 'ingest'

  // Mostra o formulário de revisão quando:
  // - recommendation chegou via SSE ou fallback API, OU
  // - SSE indicou que awaiting_confirmation está done
  const shouldShowReviewForm = hasAwaitingConfirmation || (recommendation && isRecommendation(recommendation))

  // Mostra mensagem de sucesso após conclusão
  const showSuccess = isComplete

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="knowledge-flow-title"
    >
      <button
        type="button"
        aria-label="Fechar"
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        onClick={onClose}
      />

      <div className="relative z-10 flex max-h-[90vh] w-full max-w-4xl flex-col rounded-2xl border border-border bg-card shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-border p-6">
          <div>
            <h2 id="knowledge-flow-title" className="text-lg font-semibold text-card-foreground">
              Adicionar Conhecimento
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {showSuccess 
                ? 'Documento processado com sucesso!' 
                : flowId 
                  ? 'Processando documento com Cortex...' 
                  : 'Faça upload de um documento para análise inteligente.'
              }
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            disabled={initialSubmitting || !!flowId}
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Content */}
        {!flowId ? (
          // Formulário inicial
          <form onSubmit={handleInitialSubmit} className="flex flex-col gap-5 overflow-y-auto p-6">
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
                disabled={initialSubmitting}
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={initialSubmitting}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
              >
                {initialSubmitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FileText className="size-4" />
                )}
                Processar Documento
              </button>
            </div>
          </form>
        ) : (
          // Diagrama + Formulário de revisão
          <div className="flex flex-col">
            {/* Diagrama de etapas */}
            <div className="border-b border-border p-6">
              <KnowledgeStepsDiagram steps={steps} currentStep={currentStep} operation="ingest" />
              
              {/* Mensagem de sucesso após conclusão */}
              {showSuccess && (
                <div className="mt-4 rounded-lg bg-success/20 px-4 py-3 text-center">
                  <p className="text-sm text-success font-medium">
                    ✓ Documento indexado com sucesso! Você pode fechar a janela ou revisar os dados abaixo.
                  </p>
                </div>
              )}
            </div>

            {/* Formulário de revisão - sempre visível quando temos recommendation */}
            {shouldShowReviewForm && recommendation && isRecommendation(recommendation) && (
              <div className="flex-1 overflow-y-auto p-6 max-h-[60vh]">
                {/* Recomendações do Cortex */}
                <div className="rounded-lg border border-primary/30 bg-primary/10 p-4">
                  <div className="flex items-start gap-3">
                    <img 
                      src="/cortex/cortex.png" 
                      alt="Cortex" 
                      className="size-8 animate-pulse"
                    />
                    <div className="flex-1">
                      <h3 className="text-sm font-medium text-primary mb-2">Recomendações do Cortex</h3>
                      <div className="space-y-1.5 text-xs">
                        <p><span className="text-muted-foreground">Estratégia:</span> <span className="text-foreground font-medium">{recommendation.chunking_strategy.primary.type}</span></p>
                        <p><span className="text-muted-foreground">Tamanho do chunk:</span> <span className="text-foreground">{recommendation.chunking_strategy.parameters.chunk_size}</span></p>
                        <p><span className="text-muted-foreground">Sobreposição:</span> <span className="text-foreground">{recommendation.chunking_strategy.parameters.chunk_overlap}</span></p>
                        <p className="mt-2 text-muted-foreground line-clamp-3">{recommendation.retrieval_hint}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Testing Questions Section */}
                {recommendation.testing_questions && recommendation.testing_questions.length > 0 && (
                  <div className="rounded-lg border border-secondary bg-secondary/30 p-4 mt-4">
                    <h3 className="text-sm font-medium text-secondary-foreground mb-3">Questionamentos para Validação</h3>
                    <ul className="space-y-1.5 text-xs text-foreground">
                      {recommendation.testing_questions.map((q, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="text-muted-foreground">•</span>
                          <span>{q}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Alerta de revisão necessária */}
                {recommendation.review_required && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 mt-4">
                    <p className="text-sm text-destructive">
                      <strong>Atenção:</strong> Este documento requer revisão manual. 
                      Confirme os parâmetros abaixo antes de prosseguir.
                    </p>
                  </div>
                )}

                {/* Informações do documento */}
                <div className="rounded-lg border border-border bg-background/50 p-4 mt-4">
                  <h3 className="text-sm font-medium text-foreground mb-3">Documento Analisado</h3>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <span className="text-muted-foreground">Tipo:</span>
                      <span className="ml-2 text-foreground">{recommendation.document.file_type}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Idioma:</span>
                      <span className="ml-2 text-foreground">{recommendation.document.language}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Estrutura:</span>
                      <span className="ml-2 text-foreground">{recommendation.document.structure_level}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Domínio:</span>
                      <span className="ml-2 text-foreground">{recommendation.document.domain}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Tokens estimados:</span>
                      <span className="ml-2 text-foreground">{recommendation.document.estimated_tokens?.toLocaleString()}</span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-muted-foreground">Dica de recuperação:</span>
                      <p className="ml-2 mt-1 text-foreground text-xs line-clamp-3">{recommendation.retrieval_hint}</p>
                    </div>
                  </div>
                </div>

                {/* Configurações de chunking */}
                <div className="rounded-lg border border-border bg-background/50 p-4 mt-4">
                  <h3 className="text-sm font-medium text-foreground mb-3">Estratégia de Chunking</h3>
                  
                  <Field label="Estratégia" htmlFor="chunkingStrategy">
                    <select
                      id="chunkingStrategy"
                      value={selectedStrategy}
                      onChange={(e) => setSelectedStrategy(e.target.value as ChunkingStrategyType)}
                      className={inputClass}
                    >
                      {CHUNKING_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label} — {opt.description}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <Field label="Tamanho do chunk" htmlFor="chunkSize">
                      <input
                        id="chunkSize"
                        type="number"
                        value={chunkSize}
                        onChange={(e) => setChunkSize(parseInt(e.target.value) || 512)}
                        min={100}
                        max={2048}
                        className={inputClass}
                      />
                    </Field>

                    <Field label="Sobreposição" htmlFor="chunkOverlap">
                      <input
                        id="chunkOverlap"
                        type="number"
                        value={chunkOverlap}
                        onChange={(e) => setChunkOverlap(parseInt(e.target.value) || 64)}
                        min={0}
                        max={chunkSize}
                        className={inputClass}
                      />
                    </Field>
                  </div>
                </div>

                {flowError && (
                  <p className="rounded-md bg-destructive/15 px-3 py-2 text-sm text-destructive mt-4">
                    {flowError}
                  </p>
                )}

                <div className="mt-4 flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    disabled={confirmSubmitting}
                  >
                    {showSuccess ? 'Fechar' : 'Cancelar'}
                  </button>
                  {!showSuccess && (
                    <button
                      type="button"
                      onClick={handleConfirmReview}
                      disabled={confirmSubmitting}
                      className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
                    >
                      {confirmSubmitting ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <CheckCircle2 className="size-4" />
                      )}
                      Confirmar e Indexar
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
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
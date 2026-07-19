'use client'

import { useState, useEffect, useMemo } from 'react'
import useSWR from 'swr'
import { Plus, Loader2, Tag, BookOpen, BarChart3 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Knowledge, KnowledgeResponse } from '@/lib/types'
import { KnowledgeFlowDialog } from './knowledge-flow-dialog'
import { useAuth } from '@/lib/auth-context'

const FILE_TYPE_ICONS: Record<string, string> = {
  pdf: 'PDF',
  md: 'MD',
  xlsx: 'XLSX',
  csv: 'CSV',
  txt: 'TXT',
  docx: 'DOCX',
  pptx: 'PPTX',
  other: 'FILE',
}

// Type color mapping matching the flow dialog
const TYPE_COLORS: Record<string, { bg: string; text: string }> = {
  pdf: { bg: 'bg-destructive/20', text: 'text-destructive' },
  md: { bg: 'bg-primary/20', text: 'text-primary' },
  xlsx: { bg: 'bg-success/20', text: 'text-success' },
  csv: { bg: 'bg-chart-2/20', text: 'text-chart-2' },
  default: { bg: 'bg-secondary', text: 'text-secondary-foreground' },
}

export function KnowledgeView() {
  const { user, token } = useAuth()
  const [knowledgeDialogOpen, setKnowledgeDialogOpen] = useState(false)
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  
  const { data, isLoading, mutate } = useSWR<KnowledgeResponse>(
    token ? ['/api/knowledge'] : null,
    (url: string) => fetch(url, {
      headers: { 'Authorization': `Bearer ${token}` }
    }).then((r) => r.json()),
    { revalidateOnFocus: false }
  )

  const knowledge = data?.knowledge ?? []
  const totalKnowledge = data?.totalKnowledge ?? 0
  const tagStats = data?.tagStats ?? []

  // Filter documents by selected tag
  const filteredKnowledge = useMemo(() => {
    if (!selectedTag) return knowledge
    return knowledge.filter(doc => doc.tags?.includes(selectedTag))
  }, [knowledge, selectedTag])

  // Document counts by type
  const typeStats = useMemo(() => {
    const counts: Record<string, number> = {}
    knowledge.forEach(doc => {
      const type = doc.fileType || 'other'
      counts[type] = (counts[type] || 0) + 1
    })
    return counts
  }, [knowledge])

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!user && !isLoading) {
      window.location.href = '/login'
    }
  }, [user, isLoading])

  if (!user && !isLoading) {
    return null
  }

  // Refresh knowledge list when dialog closes after successful ingest
  useEffect(() => {
    if (!knowledgeDialogOpen) {
      mutate()
    }
  }, [knowledgeDialogOpen, mutate])

  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-border bg-card/40 p-5">
      {/* Header com estatísticas */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <BookOpen className="size-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">
              Base de Conhecimento
            </h2>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {totalKnowledge}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Documentos, manuais e arquivos de referência para agentes de IA.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setKnowledgeDialogOpen(true)}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Plus className="size-4" />
          Adicionar Conhecimento
        </button>
      </div>

      {/* Stats bar - tipo de arquivo e tags */}
      {!isLoading && totalKnowledge > 0 && (
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-background/30 p-4">
          {/* Distribuição por tipo */}
          <div>
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
              <BarChart3 className="size-3.5" />
              <span>Distribuição por Tipo</span>
            </div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(typeStats).map(([type, count]) => (
                <div key={type} className="inline-flex items-center gap-1.5 rounded-md bg-secondary/50 px-2.5 py-1">
                  <span className={cn(
                    'text-xs font-semibold',
                    TYPE_COLORS[type]?.text || TYPE_COLORS.default.text
                  )}>
                    {FILE_TYPE_ICONS[type] || type.toUpperCase()}
                  </span>
                  <span className="text-xs text-muted-foreground">{count}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Tag cloud */}
          {tagStats.length > 0 && (
            <div>
              <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-2">
                <Tag className="size-3.5" />
                <span>Tags Mais Usadas</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setSelectedTag(null)}
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors',
                    selectedTag 
                      ? 'bg-secondary text-secondary-foreground hover:bg-secondary/80' 
                      : 'bg-primary/20 text-primary'
                  )}
                >
                  <span>Todas</span>
                  <span className="font-medium">{totalKnowledge}</span>
                </button>
                {tagStats.slice(0, 10).map(({ tag, count }) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => setSelectedTag(tag)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors',
                      selectedTag === tag
                        ? 'bg-primary/20 text-primary'
                        : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                    )}
                  >
                    <span>{tag}</span>
                    <span className={cn(
                      'font-medium',
                      selectedTag === tag ? 'text-primary' : 'text-muted-foreground'
                    )}>{count}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" />
          Carregando...
        </div>
      ) : knowledge.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-16 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhum conhecimento cadastrado ainda. Adicione um documento para começar.
          </p>
          <div className="mt-3 flex items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => setKnowledgeDialogOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg border border-border bg-background px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
            >
              <Plus className="size-4" />
              Adicionar Conhecimento
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredKnowledge.map((item) => (
            <KnowledgeCard key={item.id} knowledge={item} />
          ))}
        </div>
      )}

      <KnowledgeFlowDialog
        open={knowledgeDialogOpen}
        onClose={() => setKnowledgeDialogOpen(false)}
        token={token}
      />
    </div>
  )
}

function KnowledgeCard({ knowledge }: { knowledge: Knowledge }) {
  const fileExt = knowledge.fileType || 'other'
  const iconLabel = FILE_TYPE_ICONS[fileExt] || 'FILE'
  const colors = TYPE_COLORS[fileExt] || TYPE_COLORS.default
  
  // Format file size
  const fileSizeFormatted = knowledge.fileSize 
    ? `${(knowledge.fileSize / 1024).toFixed(1)} KB` 
    : null

  // Status badge
  const statusBadge = () => {
    const status = knowledge.status || 'done'
    const variants: Record<string, { bg: string; text: string }> = {
      done: { bg: 'bg-success/20', text: 'text-success' },
      awaiting_confirmation: { bg: 'bg-warning/20', text: 'text-warning' },
      processing: { bg: 'bg-primary/20', text: 'text-primary' },
      error: { bg: 'bg-destructive/20', text: 'text-destructive' },
      pending: { bg: 'bg-secondary', text: 'text-secondary-foreground' },
    }
    const v = variants[status] || variants.pending
    const label = {
      done: 'Indexado',
      awaiting_confirmation: 'Pendente',
      processing: 'Processando',
      error: 'Erro',
      pending: 'Pendente',
    }[status] || status
    
    return (
      <span className={cn(
        'inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium',
        v.bg, v.text
      )}>
        {label}
      </span>
    )
  }

  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-4 hover:bg-card/80 transition-colors">
      <div className="flex items-start gap-3">
        {/* Ícone do tipo de arquivo */}
        <div
          className={cn(
            'flex size-12 shrink-0 items-center justify-center rounded-xl font-semibold text-xs',
            colors.bg, colors.text
          )}
          aria-hidden="true"
        >
          {iconLabel}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground truncate">
              {knowledge.name}
            </h3>
            {statusBadge()}
          </div>
          <p className="mt-0.5 text-xs text-muted-foreground truncate">
            {knowledge.fileName}
          </p>
        </div>
      </div>

      {/* Informações adicionais */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
        {fileSizeFormatted && <span>{fileSizeFormatted}</span>}
        {knowledge.chunkCount !== undefined && (
          <span className="flex items-center gap-1">
            <span className="text-foreground">{knowledge.chunkCount}</span> chunks
          </span>
        )}
        {knowledge.language && <span>{knowledge.language.toUpperCase()}</span>}
        {knowledge.domain && (
          <span className={cn(
            'rounded-md px-1.5 py-0.5 text-[10px] font-medium capitalize',
            knowledge.domain === 'technical' && 'bg-primary/10 text-primary',
            knowledge.domain === 'legal' && 'bg-chart-2/10 text-chart-2',
            knowledge.domain === 'scientific' && 'bg-chart-1/10 text-chart-1',
            knowledge.domain === 'instructional' && 'bg-success/10 text-success',
          )}>
            {knowledge.domain}
          </span>
        )}
      </div>

      {/* Tags */}
      {knowledge.tags && knowledge.tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {knowledge.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-md bg-secondary px-2 py-0.5 text-[10px] text-secondary-foreground"
            >
              {tag}
            </span>
          ))}
        </div>
      )}

      {/* Retrieval hint preview */}
      {knowledge.retrievalHint && (
        <p className="mt-2 text-[10px] italic text-muted-foreground/70 line-clamp-1">
          "{knowledge.retrievalHint}"
        </p>
      )}

      <p className="mt-2 text-[10px] text-muted-foreground">
        {knowledge.createdAt && new Date(knowledge.createdAt).toLocaleDateString('pt-BR')}
      </p>
    </div>
  )
}
'use client'

import { useState, useEffect } from 'react'
import { Plus, FileText, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Knowledge } from '@/lib/types'
import { AddKnowledgeDialog } from './add-knowledge-dialog'
import { useAuth } from '@/lib/auth-context'

interface KnowledgeResponse {
  knowledge: Knowledge[]
  totalKnowledge: number
}

const FILE_TYPE_ICONS: Record<string, string> = {
  '.pdf': 'PDF',
  '.md': 'MD',
  '.xlsx': 'XLSX',
  '.csv': 'CSV',
  '.txt': 'TXT',
  '.docx': 'DOCX',
  '.pptx': 'PPTX',
}

export function KnowledgeView() {
  const { user, token } = useAuth()
  const [knowledgeDialogOpen, setKnowledgeDialogOpen] = useState(false)
  const [knowledge, setKnowledge] = useState<Knowledge[]>([])
  const [totalKnowledge, setTotalKnowledge] = useState(0)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!user) return
    
    // Carregar dados mockados por enquanto
    setTimeout(() => {
      setKnowledge([])
      setTotalKnowledge(0)
      setIsLoading(false)
    }, 300)
  }, [user])

  // Redirect to login if not authenticated
  useEffect(() => {
    if (!user && !isLoading) {
      window.location.href = '/login'
    }
  }, [user, isLoading])

  if (!user && !isLoading) {
    return null
  }

  async function handleSubmitKnowledge(payload: {
    name: string
    description?: string
    file: File
    tags?: string[]
  }) {
    // Mock implementation - apenas para demonstração
    // Na versão completa, enviaria para a API
    if (!token) {
      throw new Error('Usuário não autenticado')
    }
    
    // Simular upload
    await new Promise(resolve => setTimeout(resolve, 500))
    
    const newKnowledge: Knowledge = {
      id: Date.now().toString(),
      name: payload.name,
      description: payload.description,
      fileName: payload.file.name,
      fileType: payload.file.name.substring(payload.file.name.lastIndexOf('.')).toLowerCase(),
      fileSize: payload.file.size,
      tags: payload.tags || [],
      createdAt: new Date().toISOString(),
    }
    
    setKnowledge(prev => [...prev, newKnowledge])
    setTotalKnowledge(prev => prev + 1)
  }

  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-border bg-card/40 p-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
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
          {knowledge.map((item) => (
            <KnowledgeCard key={item.id} knowledge={item} />
          ))}
        </div>
      )}

      <AddKnowledgeDialog
        open={knowledgeDialogOpen}
        onClose={() => setKnowledgeDialogOpen(false)}
        onSubmit={handleSubmitKnowledge}
      />
    </div>
  )
}

function KnowledgeCard({ knowledge }: { knowledge: Knowledge }) {
  const fileExt = knowledge.fileType || '.file'
  const iconLabel = FILE_TYPE_ICONS[fileExt] || 'FILE'
  
  const iconBgClass = fileExt === '.pdf' ? 'bg-destructive/20 text-destructive' :
                     fileExt === '.md' ? 'bg-primary/20 text-primary' :
                     fileExt === '.xlsx' ? 'bg-success/20 text-success' :
                     fileExt === '.csv' ? 'bg-chart-2/20 text-chart-2' :
                     'bg-secondary text-secondary-foreground'

  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        {/* Ícone do tipo de arquivo */}
        <div
          className={cn(
            'flex size-12 shrink-0 items-center justify-center rounded-xl font-semibold text-xs',
            iconBgClass
          )}
          aria-hidden="true"
        >
          {iconLabel}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-foreground truncate">
            {knowledge.name}
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground truncate">
            {knowledge.fileName}
          </p>
        </div>
      </div>

      {knowledge.description && (
        <p className="mt-3 text-xs text-muted-foreground line-clamp-2">
          {knowledge.description}
        </p>
      )}

      {knowledge.tags && knowledge.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
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

      {knowledge.fileSize && (
        <p className="mt-2 text-[10px] text-muted-foreground">
          {(knowledge.fileSize / 1024).toFixed(1)} KB
        </p>
      )}
    </div>
  )
}
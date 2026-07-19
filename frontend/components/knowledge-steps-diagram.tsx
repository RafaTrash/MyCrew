'use client'

import { cn } from '@/lib/utils'
import type { KnowledgeFlowStep, ExtractionMetrics } from '@/lib/knowledge-types'
import { Check, XCircle, Loader2 } from 'lucide-react'

interface KnowledgeStepsDiagramProps {
  steps: KnowledgeFlowStep[]
  currentStep: string | null
  operation: 'ingest' | 'query' | 'quality_report'
}

// Descrições das etapas com detalhes dinâmicos
const STEP_DESCRIPTIONS: Record<string, string> = {
  extract_metadata: 'Recebendo documento e extraindo metadados via magic bytes',
  collecting_samples: 'Coletando amostras do início, meio e fim do conteúdo',
  analyze: 'Enviando conteúdo para Cortex analisar',
  validate_schema: 'Validando estrutura e integridade da resposta',
  awaiting_confirmation: 'Aguardando revisão e confirmação',
  chunking: 'Dividindo documento em chunks',
  embedding: 'Gerando embeddings vetoriais',
  done: 'Processo concluído'
}

// Função para gerar detalhes específicos do step
function getStepDetails(step: KnowledgeFlowStep): string {
  switch (step.step_id) {
    case 'extract_metadata':
      return step.output_preview || 'Preparando documento...'
    case 'collecting_samples':
      return step.output_preview || 'Analisando conteúdo...'
    case 'analyze':
      return 'Processando com Cortex (Qwen2.5)'
    case 'validate_schema':
      return step.output_preview || 'Validação concluída'
    case 'awaiting_confirmation':
      return step.output_preview || 'Pronto para revisão'
    case 'chunking':
      return step.output_preview || 'Processando chunks...'
    case 'embedding':
      return step.output_preview || 'Gerando vetores...'
    case 'done':
      return step.output_preview || 'Concluído com sucesso!'
    default:
      return ''
  }
}

/**
 * Diagrama animado de etapas do Knowledge Flow
 * Estilo "prompt chaining" com nós conectados visualmente
 */
export function KnowledgeStepsDiagram({ steps, currentStep, operation }: KnowledgeStepsDiagramProps) {
  if (!steps.length) return null

  return (
    <div className="flex flex-col items-center gap-4 py-4">
      {/* Linha do tempo horizontal */}
      <div className="relative flex w-full items-center justify-center">
        {/* Conector principal - linha tracejada */}
        <div className="absolute top-5 h-0.5 w-full max-w-4xl bg-border" aria-hidden="true" />
        
        {/* Container dos steps */}
        <div className="flex w-full max-w-4xl justify-between px-4">
          {steps.map((step, index) => (
            <StepNode 
              key={step.step_id} 
              step={step} 
              index={index} 
              isActive={currentStep === step.step_id}
              hasAnimatedConnector={index < steps.length - 1 && step.status === 'done' && steps[index + 1]?.status === 'running'}
            />
          ))}
        </div>
      </div>

      {/* Output preview do step ativo */}
      {currentStep && (
        <div className="mt-4 max-w-md text-center text-xs text-muted-foreground">
          {steps.find(s => s.step_id === currentStep)?.output_preview && (
            <p className="rounded-md bg-accent/30 px-3 py-1.5">
              {steps.find(s => s.step_id === currentStep)?.output_preview}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

interface StepNodeProps {
  step: KnowledgeFlowStep
  index: number
  isActive: boolean
  hasAnimatedConnector: boolean
}

function StepNode({ step, index, isActive, hasAnimatedConnector }: StepNodeProps) {
  const getStatusIcon = () => {
    switch (step.status) {
      case 'done':
        return <Check className="size-4 text-success" />
      case 'error':
        return <XCircle className="size-4 text-destructive" />
      case 'running':
        return <Loader2 className="size-4 animate-spin text-primary" />
      default:
        return (
          <div className="size-2.5 rounded-full bg-border" />
        )
    }
  }

  // Extrai métricas do recommendation (se houver)
  const ollamaMetrics = step.recommendation?.ollama_metrics as { total_ms?: number; tokens_generated?: number; throughput_tps?: number } | undefined
  
  // Extrai métricas de extração
  const extractionMetrics = step.recommendation?.extraction_metrics as ExtractionMetrics | undefined

  return (
    <div className="group relative flex flex-col items-center" style={{ zIndex: 10 }}>
      {/* Círculo do nó */}
      <div
        className={cn(
          'flex size-10 items-center justify-center rounded-full border-2 transition-all duration-300',
          step.status === 'done' && 'border-success bg-success/10',
          step.status === 'running' && 'border-primary bg-primary/10 shadow-lg shadow-primary/20',
          step.status === 'error' && 'border-destructive bg-destructive/10',
          step.status === 'pending' && 'border-border bg-background',
          isActive && 'scale-110'
        )}
        aria-label={`${step.step_name}: ${step.status}`}
      >
        {getStatusIcon()}
      </div>

      {/* Texto do step */}
      <div className="mt-2 max-w-[100px] text-center">
        <p
          className={cn(
            'text-xs font-medium leading-tight',
            step.status === 'done' && 'text-success',
            step.status === 'running' && 'text-primary',
            step.status === 'error' && 'text-destructive',
            step.status === 'pending' && 'text-muted-foreground'
          )}
        >
          {step.step_name}
        </p>
        
        {/* Métricas de duração */}
        {step.duration_formatted && (
          <p className="mt-0.5 text-sm text-muted-foreground">
            {step.duration_formatted}
          </p>
        )}
      </div>

       {/* Tooltip com descrição e métricas */}
       <div className="absolute bottom-full mb-2 hidden w-64 rounded-md bg-popover px-3 py-2 text-sm text-popover-foreground shadow-lg group-hover:block pointer-events-none">
         <p className="font-medium mb-1">{step.step_name}</p>
         <p className="mt-0.5 text-muted-foreground text-xs">{STEP_DESCRIPTIONS[step.step_id] || 'Passo do processo'}</p>
         {/* Detalhes específicos do step */}
         <p className="mt-1 text-foreground text-xs line-clamp-2">{getStepDetails(step)}</p>
         {ollamaMetrics && step.status === 'done' && (
           <div className="mt-1.5 border-t border-border pt-1">
             <p className="text-[9px]"><span className="text-muted-foreground">Tokens:</span> {ollamaMetrics.tokens_generated}</p>
             <p className="text-[9px]"><span className="text-muted-foreground">Throughput:</span> {ollamaMetrics.throughput_tps} t/s</p>
             <p className="text-[9px]"><span className="text-muted-foreground">Tempo:</span> {ollamaMetrics.total_ms}ms</p>
           </div>
         )}
         {/* Métricas de extração para o step extract_metadata */}
         {extractionMetrics && step.step_id === 'extract_metadata' && (
           <div className="mt-1.5 border-t border-border pt-1 max-h-32 overflow-y-auto">
             <p className="text-[9px]"><span className="text-muted-foreground">Tipo:</span> {extractionMetrics.file_type.toUpperCase()}</p>
             <p className="text-[9px]"><span className="text-muted-foreground">Idioma:</span> {extractionMetrics.language}</p>
             <p className="text-[9px]"><span className="text-muted-foreground">Estrutura:</span> {extractionMetrics.structure.structure_level}</p>
             {extractionMetrics.structure.headings && (
               <p className="text-[9px]"><span className="text-muted-foreground">Headings:</span> H1={extractionMetrics.structure.headings.h1}, H2={extractionMetrics.structure.headings.h2}</p>
             )}
             {extractionMetrics.structure.has_tables && (
               <p className="text-[9px]"><span className="text-muted-foreground">Tabelas:</span> detectadas</p>
             )}
             {extractionMetrics.structure.has_code && (
               <p className="text-[9px]"><span className="text-muted-foreground">Código:</span> presente</p>
             )}
             <p className="text-[9px]"><span className="text-muted-foreground">Tempo extracao:</span> {extractionMetrics.extraction_time_ms}ms</p>
           </div>
         )}
       </div>

      {/* Linha animada entre nós */}
      {hasAnimatedConnector && (
        <AnimatedConnector />
      )}
    </div>
  )
}

function AnimatedConnector() {
  return (
    <div className="absolute -right-8 top-5 h-0.5 w-16 overflow-hidden" aria-hidden="true">
      <div className="h-full w-full bg-gradient-to-r from-primary via-primary/50 to-transparent">
        <div className="animate-flow absolute inset-y-0 left-0 w-4 bg-primary shadow-lg shadow-primary/50" />
      </div>
    </div>
  )
}
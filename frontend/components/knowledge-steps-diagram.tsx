'use client'

import { cn } from '@/lib/utils'
import type { KnowledgeFlowStep } from '@/lib/knowledge-types'
import { Check, XCircle, Loader2 } from 'lucide-react'

interface KnowledgeStepsDiagramProps {
  steps: KnowledgeFlowStep[]
  currentStep: string | null
  operation: 'ingest' | 'query' | 'quality_report'
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

  return (
    <div className="relative flex flex-col items-center" style={{ zIndex: 10 }}>
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
      <div className="mt-2 max-w-[80px] text-center">
        <p
          className={cn(
            'text-[10px] font-medium leading-tight',
            step.status === 'done' && 'text-success',
            step.status === 'running' && 'text-primary',
            step.status === 'error' && 'text-destructive',
            step.status === 'pending' && 'text-muted-foreground'
          )}
        >
          {step.step_name}
        </p>
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
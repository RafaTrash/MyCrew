'use client'

import { useState } from 'react'
import { CortexAvatar } from '@/components/Avatar'
import type { CortexStatus } from '@/components/Avatar/types'

export default function AvatarDemoPage() {
  const [status, setStatus] = useState<CortexStatus>('idle')
  
  const statuses: CortexStatus[] = ['idle', 'thinking', 'processing', 'talking', 'learning', 'offline', 'error']
  
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 p-8 bg-background">
      <h1 className="text-2xl font-bold text-foreground">CortexAvatar Demo</h1>
      
      <div className="flex items-center justify-center gap-12">
        <div className="flex flex-col items-center gap-4">
          <div className="text-sm text-muted-foreground">Tamanhos</div>
          <div className="flex items-end gap-8">
            <div className="flex flex-col items-center gap-2">
              <CortexAvatar status={status} size={48} />
              <span className="text-xs text-muted-foreground">48px</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <CortexAvatar status={status} size={64} />
              <span className="text-xs text-muted-foreground">64px</span>
            </div>
            <div className="flex flex-col items-center gap-2">
              <CortexAvatar status={status} size={96} />
              <span className="text-xs text-muted-foreground">96px</span>
            </div>
          </div>
        </div>
      </div>
      
      <div className="flex flex-col items-center gap-4">
        <div className="text-sm text-muted-foreground">Estados</div>
        <div className="flex flex-wrap gap-2">
          {statuses.map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
                status === s
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-secondary-foreground hover:bg-accent'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      
      <div className="text-xs text-muted-foreground">
        Status atual: <span className="font-semibold text-foreground">{status}</span>
      </div>
    </div>
  )
}
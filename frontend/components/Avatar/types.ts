'use client'

export type CortexStatus = 'idle' | 'thinking' | 'processing' | 'talking' | 'learning' | 'offline' | 'error'

export interface CortexAvatarProps {
  status?: CortexStatus
  size?: number
  className?: string
}
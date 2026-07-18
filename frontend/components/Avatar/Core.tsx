'use client'

import { motion } from 'framer-motion'
import type { CortexStatus } from './types'

interface CoreProps {
  status: CortexStatus
  size: number
}

export function Core({ status, size }: CoreProps) {
  // IDs únicas para gradientes (evita conflitos com múltiplos avatares)
  const gradientId = `coreGradient-${status}`
  const innerGradientId = `innerCoreGradient-${status}`

  // Cores baseadas no estado
  const getCoreColors = () => {
    if (status === 'offline') {
      return {
        primary: 'oklch(0.4 0.05 165 / 0.3)',
        secondary: 'oklch(0.3 0.05 165 / 0.2)',
      }
    }
    if (status === 'error') {
      return {
        primary: 'oklch(0.7 0.2 25)', // Vermelho
        secondary: 'oklch(0.5 0.25 25)',
      }
    }
    return {
      primary: 'oklch(0.75 0.16 165)', // Ciano/verde (primary)
      secondary: 'oklch(0.87 0.08 165)',
    }
  }

  const colors = getCoreColors()

  // Animação de pulsação - usando scale e opacity
  const getPulseAnimation = () => {
    if (status === 'offline') {
      return {
        scale: 1,
        opacity: 0.3,
      }
    }
    if (status === 'error') {
      return {
        scale: [1, 1.2, 1],
        opacity: [1, 1, 1],
        transition: {
          duration: 0.3,
          ease: 'easeInOut' as const,
          repeat: 1,
        },
      }
    }

    // Animações para outros estados
    const configs: Record<Exclude<CortexStatus, 'offline' | 'error'>, { 
      scale: number[]
      duration: number 
    }> = {
      idle: {
        scale: [1, 1.03, 1],
        duration: 3,
      },
      thinking: {
        scale: [1, 1.08, 1],
        duration: 1.5,
      },
      processing: {
        scale: [1, 1.12, 1],
        duration: 0.8,
      },
      talking: {
        scale: [1, 1.05, 1],
        duration: 0.5,
      },
      learning: {
        scale: [1, 1.1, 1],
        duration: 2,
      },
    }

    return {
      scale: configs[status].scale,
      transition: {
        duration: configs[status].duration,
        ease: 'easeInOut' as const,
        repeat: Infinity,
      },
    }
  }

  const pulseAnimation = getPulseAnimation()

  return (
    <motion.svg
      viewBox="0 0 48 48"
      className="absolute inset-0"
      animate={pulseAnimation}
      initial={pulseAnimation}
    >
      {/* Gradiente radial para o núcleo */}
      <defs>
        <radialGradient id={gradientId} cx="30%" cy="30%" r="70%">
          <stop offset="0%" stopColor={colors.secondary} />
          <stop offset="70%" stopColor={colors.primary} />
          <stop offset="100%" stopColor="oklch(0.2 0.1 165)" />
        </radialGradient>
        {/* Núcleo interno */}
        <radialGradient id={innerGradientId} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="white" stopOpacity={status === 'offline' ? 0.2 : 0.8} />
          <stop offset="100%" stopColor={colors.primary} stopOpacity={status === 'offline' ? 0.1 : 0.6} />
        </radialGradient>
      </defs>

      {/* Núcleo principal - hexágono holográfico */}
      <path
        d="M24 8 L36 14 L36 26 L24 32 L12 26 L12 14 Z"
        fill={`url(#${gradientId})`}
        stroke={status === 'offline' ? 'oklch(0.5 0.05 165 / 0.3)' : 'oklch(0.9 0.08 165 / 0.5)'}
        strokeWidth={status === 'offline' ? 0.5 : 1}
      />

      {/* Núcleo interno */}
      <path
        d="M24 14 L30 17 L30 24 L24 27 L18 24 L18 17 Z"
        fill={`url(#${innerGradientId})`}
      />
    </motion.svg>
  )
}
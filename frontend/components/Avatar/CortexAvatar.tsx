'use client'

import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Core } from './Core'
import { OrbitRing } from './OrbitRing'
import { Glow } from './Glow'
import { Particles } from './Particles'
import type { CortexStatus, CortexAvatarProps } from './types'

export function CortexAvatar({ 
  status = 'idle', 
  size = 48,
  className 
}: CortexAvatarProps) {
  const [displayStatus, setDisplayStatus] = useState<CortexStatus>(status)
  const [previousStatus, setPreviousStatus] = useState<CortexStatus>(status)

  // Handle error auto-recovery
  useEffect(() => {
    if (status !== 'error') {
      setPreviousStatus(status)
      setDisplayStatus(status)
      return
    }
    
    setDisplayStatus('error')
    const timeout = setTimeout(() => {
      // Retorna ao estado anterior após o flash de erro
      setDisplayStatus(previousStatus !== 'error' ? previousStatus : 'idle')
    }, 300)
    return () => clearTimeout(timeout)
  }, [status, previousStatus])

  // Variantes para hover
  const containerVariants = {
    initial: { scale: 1 },
    hover: { 
      scale: 1.05,
      transition: {
        type: 'spring' as const,
        stiffness: 200,
        damping: 15,
      },
    },
  }

  return (
    <motion.div
      className={`relative shrink-0 ${className || ''}`}
      style={{ width: size, height: size }}
      variants={containerVariants}
      initial="initial"
      whileHover="hover"
    >
      {/* Glow - camada mais externa */}
      <Glow status={displayStatus} />

      {/* Particles - atrás dos anéis */}
      <Particles status={displayStatus} />

      {/* Outer Ring - anel externo */}
      <OrbitRing status={displayStatus} isOuter={true} />

      {/* Inner Ring - anel interno */}
      <OrbitRing status={displayStatus} isOuter={false} />

      {/* Core - núcleo central */}
      <Core status={displayStatus} size={size} />
    </motion.div>
  )
}
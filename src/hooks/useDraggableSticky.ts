'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

interface Position {
  x: number
  y: number
}

interface UseDraggableStickyOptions {
  initialY?: number
  margin?: number
  buttonWidth?: number
}

export function useDraggableSticky(options: UseDraggableStickyOptions = {}) {
  const { initialY = 100, margin = 16, buttonWidth = 44 } = options
  
  const [position, setPosition] = useState<Position>({ x: 0, y: initialY })
  const [isDragging, setIsDragging] = useState(false)
  const [dragX, setDragX] = useState(0)
  const dragRef = useRef<HTMLDivElement>(null)
  const startPos = useRef<Position>({ x: 0, y: 0 })

  // Initialize position on client mount
  useEffect(() => {
    const handleInit = () => {
      const initialX = window.innerWidth - buttonWidth - margin
      const finalY = window.innerHeight - initialY
      setDragX(initialX)
      setPosition({ x: initialX, y: finalY })
    }
    
    // Use rAF to avoid SSR-client mismatch and sync state warnings
    const frame = requestAnimationFrame(handleInit)
    return () => cancelAnimationFrame(frame)
  }, [buttonWidth, margin, initialY])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    setIsDragging(true)
    const touch = e.touches[0]
    const rect = dragRef.current?.getBoundingClientRect()
    if (rect) {
      startPos.current = { x: touch.clientX - rect.left, y: touch.clientY - rect.top }
      setDragX(rect.left)
    }
  }, [])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging) return
    if (e.cancelable) e.preventDefault()
    
    const touch = e.touches[0]
    let newX = touch.clientX - startPos.current.x
    let newY = touch.clientY - startPos.current.y
    
    // Bound checking
    newX = Math.max(0, Math.min(newX, window.innerWidth - buttonWidth))
    newY = Math.max(80, Math.min(newY, window.innerHeight - 80))
    
    setDragX(newX)
    setPosition({ x: newX, y: newY })
  }, [isDragging, buttonWidth])

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false)
    const centerX = dragX + buttonWidth / 2
    
    let finalX: number
    if (centerX > window.innerWidth / 2) {
      finalX = window.innerWidth - buttonWidth - margin
    } else {
      finalX = margin
    }
    
    setDragX(finalX)
    setPosition(prev => ({ ...prev, x: finalX }))
  }, [dragX, buttonWidth, margin])

  return {
    dragRef,
    dragX,
    position,
    isDragging,
    handlers: {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd
    }
  }
}

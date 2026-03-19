'use client'

import { useState, useEffect } from 'react'
import { ChevronUp } from 'lucide-react'
import { useDraggableSticky } from '@/hooks/useDraggableSticky'

export default function ScrollToTopButton() {
  const [isVisible, setIsVisible] = useState(false)
  const { dragRef, dragX, position, isDragging, handlers } = useDraggableSticky({
    initialY: 160,
    margin: 16
  })

  useEffect(() => {
    const toggleVisibility = () => {
      if (window.pageYOffset > 300) setIsVisible(true)
      else setIsVisible(false)
    }
    window.addEventListener('scroll', toggleVisibility)
    
    return () => window.removeEventListener('scroll', toggleVisibility)
  }, [])

  const scrollToTop = () => {
    if (isDragging) return
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (!isVisible) return null

  return (
    <div
      ref={dragRef}
      {...handlers}
      onClick={scrollToTop}
      style={{
        position: 'fixed',
        left: `${dragX}px`,
        top: `${position.y}px`,
        zIndex: 100,
        width: '44px',
        height: '44px',
        borderRadius: '50%',
        background: 'white',
        boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        border: '1px solid #e2e8f0',
        touchAction: 'none',
        transition: isDragging ? 'none' : 'all 0.5s cubic-bezier(0.19, 1, 0.22, 1)'
      }}
    >
      <ChevronUp size={24} className="text-slate-600" />
    </div>
  )
}

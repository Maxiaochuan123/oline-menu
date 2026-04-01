'use client'

import { Clock, CheckCircle2, XCircle } from 'lucide-react'

interface OrderStatusHeroProps {
  status: string
  statusLabel: string
  color: string
  description: string
}

export default function OrderStatusHero({ status, statusLabel, color, description }: OrderStatusHeroProps) {
  const getIcon = () => {
    switch (status) {
      case 'completed': return <CheckCircle2 size={40} className="animate-in zoom-in duration-500" />
      case 'cancelled': return <XCircle size={40} />
      case 'pending': return <Clock size={40} className="animate-pulse" />
      default: return <Clock size={40} />
    }
  }

  return (
    <div 
      className="text-white px-6 pt-10 pb-20 text-center transition-all duration-500 ease-in-out relative overflow-hidden"
      style={{ backgroundColor: color }}
    >
      {/* 背景装饰性圆圈 */}
      <div className="absolute -right-10 -top-10 w-40 h-40 bg-white/10 rounded-full blur-2xl" />
      <div className="absolute -left-10 -bottom-10 w-32 h-32 bg-black/5 rounded-full blur-xl" />

      <div className="relative z-10 flex flex-col items-center gap-3">
        <div className="p-3 bg-white/20 rounded-full backdrop-blur-md shadow-inner">
          {getIcon()}
        </div>
        <h1 className="text-3xl font-black tracking-tight">{statusLabel}</h1>
        <p className="opacity-90 text-sm font-medium max-w-[280px] leading-relaxed">
          {description}
        </p>
      </div>
    </div>
  )
}

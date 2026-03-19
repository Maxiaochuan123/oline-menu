'use client'

import { cn } from '@/lib/utils'

interface OrderStatusBarProps {
  currentStep: number
  statusColor: string
}

export default function OrderStatusBar({ currentStep, statusColor }: OrderStatusBarProps) {
  const steps = [
    { id: 1, label: '待收单' },
    { id: 2, label: '制作中' },
    { id: 3, label: '配送中' },
    { id: 4, label: '已完成' }
  ]

  // 如果已取消，显示特殊的进度或不显示
  if (currentStep === 0) return null

  return (
    <div className="flex items-center justify-between px-2 mb-8 mt-2">
      {steps.map((step, idx) => (
        <div key={step.id} className="flex-1 flex flex-col items-center relative">
          {/* 连接线 */}
          {idx < steps.length - 1 && (
            <div 
              className={cn(
                "absolute top-[14px] left-[50%] w-full h-[2px] transition-all duration-700",
                currentStep > step.id ? "bg-orange-500" : "bg-slate-100"
              )} 
            />
          )}
          
          {/* 圆点 */}
          <div 
            className={cn(
              "z-10 w-7 h-7 rounded-full flex items-center justify-center transition-all duration-500 border-2 border-white",
              currentStep >= step.id ? "bg-orange-500 shadow-md shadow-orange-200 scale-110" : "bg-slate-100"
            )}
          >
            {currentStep > step.id ? (
              <span className="text-white text-[10px] font-black italic">✔</span>
            ) : (
              <span className={cn("text-[10px] font-black", currentStep === step.id ? "text-white" : "text-slate-400")}>
                {step.id}
              </span>
            )}
          </div>
          
          {/* 文字说明 */}
          <span className={cn(
            "text-[10px] mt-2.5 font-black tracking-tighter transition-colors",
            currentStep === step.id ? "text-slate-900" : "text-slate-400"
          )}>
            {step.label}
          </span>
        </div>
      ))}
    </div>
  )
}

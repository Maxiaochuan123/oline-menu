'use client'

import { cn } from '@/lib/utils'

interface OrderStatusBarProps {
  currentStep: number
}

export default function OrderStatusBar({ currentStep }: OrderStatusBarProps) {
  const steps = [
    { id: 1, label: '待收单' },
    { id: 2, label: '制作中' },
    { id: 3, label: '配送中' },
    { id: 4, label: '已完成' }
  ]

  // 如果已取消，显示特殊的进度或不显示
  if (currentStep === 0) return null

  return (
    <div className="flex items-center justify-between px-2 mb-10 mt-4">
      {steps.map((step, idx) => (
        <div key={step.id} className="flex-1 flex flex-col items-center relative">
          {/* 连接线 */}
          {idx < steps.length - 1 && (
            <div 
              className={cn(
                "absolute top-[18px] left-[50%] w-full h-[3px] transition-all duration-700 rounded-full",
                currentStep > step.id ? "bg-orange-500" : "bg-slate-100"
              )} 
            />
          )}
          
          {/* 圆点 */}
          <div 
            className={cn(
              "z-10 w-9 h-9 rounded-full flex items-center justify-center transition-all duration-500 border-[3px] border-white shadow-sm",
              currentStep >= step.id 
                ? "bg-orange-500 shadow-xl shadow-orange-200 scale-110" 
                : "bg-slate-100 border-none"
            )}
          >
            {currentStep > step.id ? (
              <span className="text-white text-[12px] font-black">✔</span>
            ) : (
              <span className={cn("text-[13px] font-black", currentStep === step.id ? "text-white" : "text-slate-400")}>
                {step.id}
              </span>
            )}
          </div>
          
          {/* 文字说明 */}
          <span className={cn(
            "text-[12px] mt-3 font-black tracking-tight transition-all uppercase",
            currentStep === step.id ? "text-slate-900 scale-105" : "text-slate-400"
          )}>
            {step.label}
          </span>
        </div>
      ))}
    </div>
  )
}

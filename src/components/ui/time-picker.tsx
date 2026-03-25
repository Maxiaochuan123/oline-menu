"use client"

import * as React from "react"
import { Clock } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"

interface TimePickerProps {
  value?: string // format: "HH:mm"
  onChange?: (time: string) => void
  isTimeDisabled?: (time: string) => boolean
  onDisabledSelect?: (time: string) => void
  disabledHours?: string[]
  className?: string
}

export function TimePicker({ 
  value = "09:00", 
  onChange, 
  isTimeDisabled, 
  onDisabledSelect,
  className 
}: TimePickerProps) {
  const [isOpen, setIsOpen] = React.useState(false)
  const hourScrollRef = React.useRef<HTMLDivElement>(null)
  const minuteScrollRef = React.useRef<HTMLDivElement>(null)
  
  // Parse current value
  const [hour, minute] = value.split(":").map(Number)
  
  const hours = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, "0"))
  const minutes = Array.from({ length: 60 }, (_, i) => i.toString().padStart(2, "0"))

  // 当打开时，自动滚动到对应位置
  React.useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        const activeHour = hourScrollRef.current?.querySelector('[data-active="true"]')
        const activeMinute = minuteScrollRef.current?.querySelector('[data-active="true"]')
        activeHour?.scrollIntoView({ block: 'center', behavior: 'smooth' })
        activeMinute?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }, 50)
    }
  }, [isOpen])

  const handleHourSelect = (h: string) => {
    const m = minute.toString().padStart(2, "0")
    const newTime = `${h}:${m}`
    if (isTimeDisabled?.(newTime)) {
      onDisabledSelect?.(newTime)
    } else {
      onChange?.(newTime)
    }
  }

  const handleMinuteSelect = (m: string) => {
    const h = hour.toString().padStart(2, "0")
    const newTime = `${h}:${m}`
    if (isTimeDisabled?.(newTime)) {
      onDisabledSelect?.(newTime)
    } else {
      onChange?.(newTime)
    }
  }

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={isOpen}
            className={cn(
              "h-12 w-full justify-start gap-2.5 rounded-xl border-slate-100 bg-white px-4 font-bold text-slate-900 transition-all active:scale-95",
              className
            )}
          />
        }
      >
        <Clock className="size-4 text-slate-400" />
        <span>{value}</span>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0 rounded-2xl border-none shadow-2xl overflow-hidden" align="start">
        <div className="flex h-64 border-slate-100">
          {/* Hours Scroll Area */}
          <ScrollArea className="w-16 border-r border-slate-50" ref={hourScrollRef}>
            <div className="flex flex-col p-1.5">
              {hours.map((h) => {
                const isActive = hour.toString().padStart(2, "0") === h
                // 判断小时是否被禁用的逻辑由外部决定
                // 如果传入了 isTimeDisabled，粗略检查小时（判断小时内是否有可选分钟）
                const isDisabled = isTimeDisabled ? !Array.from({length: 60}).some((_, m) => !isTimeDisabled(`${h}:${m.toString().padStart(2, '0')}`)) : false

                return (
                <Button
                  key={h}
                  variant="ghost"
                  data-active={isActive}
                  className={cn(
                    "h-9 w-full rounded-lg text-sm font-bold transition-all",
                    isActive 
                      ? "bg-slate-900 text-white hover:bg-slate-800" 
                      : isDisabled ? "text-slate-200 cursor-not-allowed" : "text-slate-500 hover:bg-slate-100"
                  )}
                  onClick={() => handleHourSelect(h)}
                >
                  {h}
                </Button>
              )})}
            </div>
          </ScrollArea>
          
          {/* Minutes Scroll Area */}
          <ScrollArea className="w-16" ref={minuteScrollRef}>
            <div className="flex flex-col p-1.5">
              {minutes.map((m) => {
                const isActive = minute.toString().padStart(2, "0") === m
                const hStr = hour.toString().padStart(2, "0")
                const isDisabled = isTimeDisabled?.(`${hStr}:${m}`)

                return (
                <Button
                  key={m}
                  variant="ghost"
                  data-active={isActive}
                  className={cn(
                    "h-9 w-full rounded-lg text-sm font-bold transition-all",
                    isActive 
                      ? "bg-blue-600 text-white hover:bg-blue-500" 
                      : isDisabled ? "text-slate-200 cursor-not-allowed" : "text-slate-500 hover:bg-slate-100"
                  )}
                  onClick={() => handleMinuteSelect(m)}
                >
                  {m}
                </Button>
              )})}
            </div>
          </ScrollArea>
        </div>
        
        <div className="p-2 border-t border-slate-50 bg-slate-50/50 flex justify-center">
           <Button 
            variant="ghost" 
            size="sm" 
            className="text-[10px] uppercase font-black tracking-widest text-slate-400 hover:text-slate-900 h-6"
            onClick={() => setIsOpen(false)}
           >
             确认选择
           </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

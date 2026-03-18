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
  className?: string
}

export function TimePicker({ value = "09:00", onChange, className }: TimePickerProps) {
  const [isOpen, setIsOpen] = React.useState(false)
  
  // Parse initial value
  const [hour, minute] = value.split(":").map(Number)
  
  const hours = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, "0"))
  const minutes = Array.from({ length: 60 }, (_, i) => i.toString().padStart(2, "0"))

  const handleHourSelect = (h: string) => {
    const m = minute.toString().padStart(2, "0")
    onChange?.(`${h}:${m}`)
  }

  const handleMinuteSelect = (m: string) => {
    const h = hour.toString().padStart(2, "0")
    onChange?.(`${h}:${m}`)
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
          <ScrollArea className="w-16 border-r border-slate-50">
            <div className="flex flex-col p-1.5">
              {hours.map((h) => (
                <Button
                  key={h}
                  variant="ghost"
                  className={cn(
                    "h-9 w-full rounded-lg text-sm font-bold transition-all",
                    hour.toString().padStart(2, "0") === h 
                      ? "bg-slate-900 text-white hover:bg-slate-800" 
                      : "text-slate-500 hover:bg-slate-100"
                  )}
                  onClick={() => handleHourSelect(h)}
                >
                  {h}
                </Button>
              ))}
            </div>
          </ScrollArea>
          
          {/* Minutes Scroll Area */}
          <ScrollArea className="w-16">
            <div className="flex flex-col p-1.5">
              {minutes.map((m) => (
                <Button
                  key={m}
                  variant="ghost"
                  className={cn(
                    "h-9 w-full rounded-lg text-sm font-bold transition-all",
                    minute.toString().padStart(2, "0") === m 
                      ? "bg-blue-600 text-white hover:bg-blue-500" 
                      : "text-slate-500 hover:bg-slate-100"
                  )}
                  onClick={() => handleMinuteSelect(m)}
                >
                  {m}
                </Button>
              ))}
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

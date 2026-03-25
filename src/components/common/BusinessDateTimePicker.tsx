"use client"

import * as React from "react"
import { format, isBefore, startOfDay, addMinutes } from "date-fns"
import { zhCN } from "date-fns/locale"
import { Calendar as CalendarIcon } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { TimePicker } from "@/components/ui/time-picker"
import { useToast } from "@/components/common/Toast"
import { SOLAR_HOLIDAYS, LUNAR_HOLIDAYS } from "@/lib/holidays"
import type { Merchant, DisabledDate } from "@/lib/types"

interface BusinessDateTimePickerProps {
  value?: Date | null
  onChange: (date: Date | null) => void
  merchant: Merchant | null
  disabledDates?: DisabledDate[]
  placeholder?: string
  className?: string
  minTimeBuffer?: number // 冗余分钟，例如必须 15 分钟后生效
  label?: string
  onHolidaySelect?: (name: string, duration: number) => void
}

export function BusinessDateTimePicker({
  value,
  onChange,
  merchant,
  disabledDates = [],
  placeholder = "选择日期时间",
  className,
  minTimeBuffer = 0,
  label,
  onHolidaySelect
}: BusinessDateTimePickerProps) {
  const { toast } = useToast()
  
  const openTime = merchant?.business_hours?.is_enabled ? (merchant.business_hours.open_time || "09:00") : "00:00"
  const closeTime = merchant?.business_hours?.is_enabled ? (merchant.business_hours.close_time || "23:59") : "23:59"

  const dateObj = value || null
  const timeStr = dateObj ? format(dateObj, "HH:mm") : openTime

  const validateAndSet = (d: Date, t: string) => {
    const [hh, mm] = t.split(":").map(Number)
    const finalDate = new Date(d)
    finalDate.setHours(hh, mm, 0, 0)

    // 1. 营业时间校验 (仅当 merchant 开启了营业时间)
    if (merchant?.business_hours?.is_enabled) {
        if (t < openTime || t > closeTime) {
          toast(`所选时间不在营业范围内 (${openTime} - ${closeTime})`, "warning")
          return
        }
    }

    // 2. 过去时间校验
    const now = new Date()
    const buffer = addMinutes(now, minTimeBuffer)
    if (isBefore(finalDate, buffer)) {
      toast(minTimeBuffer > 0 ? `时间无效 (需晚于当前时间 ${minTimeBuffer} 分钟)` : "时间无效 (必须晚于当前时间)", "warning")
      return
    }

    onChange(finalDate)
  }

  const handleDateSelect = (d: Date | undefined) => {
    if (!d) return
    validateAndSet(d, timeStr)
  }

  const handleTimeSelect = (t: string) => {
    const baseDate = dateObj || new Date()
    // 如果 baseDate 是过去日期且我们之前选的是今天，补正为今天
    const today = new Date()
    if (isBefore(baseDate, startOfDay(today))) {
        baseDate.setFullYear(today.getFullYear(), today.getMonth(), today.getDate())
    }
    validateAndSet(baseDate, t)
  }

  const isDayDisabled = React.useCallback((date: Date) => {
    const today = startOfDay(new Date())
    const dStr = format(date, "yyyy-MM-dd")
    
    // 禁用今天之前的日期
    if (isBefore(date, today)) return true
    
    // 禁用停业日期
    if (disabledDates.some(dd => dd.disabled_date === dStr)) return true

    return false
  }, [disabledDates])

  // 计算未来 6 个月内的节假日快捷选
  const upcomingHolidays = React.useMemo(() => {
    const now = new Date()
    const horizon = new Date()
    horizon.setMonth(now.getMonth() + 6)
    
    const list: { date: Date, name: string, duration: number }[] = []
    
    // 处理公历
    Object.entries(SOLAR_HOLIDAYS).forEach(([mmdd, h]) => {
      const [m, d] = mmdd.split('-').map(Number)
      const date = new Date(now.getFullYear(), m - 1, d)
      if (isBefore(date, now)) date.setFullYear(now.getFullYear() + 1)
      if (date <= horizon && !isDayDisabled(date)) list.push({ date, name: h.name, duration: h.duration })
    })

    // 处理农历
    Object.entries(LUNAR_HOLIDAYS).forEach(([yyyymmdd, h]) => {
      const date = new Date(yyyymmdd)
      if (date >= startOfDay(now) && date <= horizon && !isDayDisabled(date)) {
        list.push({ date, name: h.name, duration: h.duration })
      }
    })

    return list.sort((a, b) => a.date.getTime() - b.date.getTime()).slice(0, 8)
  }, [isDayDisabled])

  const handleHolidaySelect = (d: Date) => {
    // 默认设置为开店时间或 00:00，方便商户在节日第一秒发券
    const targetTime = merchant?.business_hours?.is_enabled ? (merchant.business_hours.open_time || "00:00") : "00:00"
    validateAndSet(d, targetTime)
  }

  return (
    <div className={cn("space-y-2", className)}>
      {label && (
        <label className="text-[11px] font-black text-slate-500 uppercase tracking-tighter ml-1">
          {label}
        </label>
      )}
      {upcomingHolidays.length > 0 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1.5 no-scrollbar scroll-smooth">
          <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest shrink-0 mr-1 py-1">推荐:</span>
          {upcomingHolidays.map((h, i) => {
            const isSelected = dateObj && format(dateObj, "yyyy-MM-dd") === format(h.date, "yyyy-MM-dd")
            return (
              <button
                key={i}
                type="button"
                onClick={() => {
                  handleHolidaySelect(h.date)
                  onHolidaySelect?.(h.name, h.duration)
                }}
                className={cn(
                  "shrink-0 px-3 py-1 rounded-full border text-[10px] font-black tracking-tight transition-all active:scale-90",
                  isSelected 
                    ? "bg-violet-600 text-white border-violet-600 shadow-sm shadow-violet-200" 
                    : "bg-violet-50 text-violet-600 border-violet-100/50 hover:bg-violet-100"
                )}
              >
                {h.name}
              </button>
            )
          })}
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        {/* 日期选择器 */}
        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant="outline"
                className={cn(
                  "h-12 w-full justify-start text-left font-bold rounded-2xl border-transparent bg-slate-50 transition-all hover:bg-slate-100 text-[14px] shadow-sm px-3",
                  !dateObj && "text-slate-400"
                )}
              />
            }
          >
            <CalendarIcon className="mr-2 h-4 w-4 text-slate-400" />
            <span className="truncate">
              {dateObj ? format(dateObj, "y-MM-dd", { locale: zhCN }) : placeholder}
            </span>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0 rounded-2xl border-none shadow-2xl z-50" align="start">
            <Calendar
              mode="single"
              selected={dateObj || undefined}
              onSelect={handleDateSelect}
              disabled={isDayDisabled}
              initialFocus
              locale={zhCN}
            />
          </PopoverContent>
        </Popover>

        {/* 时间选择器 */}
        <TimePicker
          value={timeStr}
          onChange={handleTimeSelect}
          isTimeDisabled={(t) => merchant?.business_hours?.is_enabled ? (t < openTime || t > closeTime) : false}
          onDisabledSelect={() => toast(`不可选择非营业时间 (${openTime} - ${closeTime})`, "warning")}
          className="w-full h-12 bg-slate-50 border-transparent text-[14px] rounded-2xl shadow-sm hover:bg-slate-100"
        />
      </div>
    </div>
  )
}

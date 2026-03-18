import { Message } from '@/lib/types'
import { Star, AlertCircle, CheckCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'

interface MessageBubbleProps {
  msg: Message
  currentUserRole: 'merchant' | 'customer'
  showTime?: boolean
}

export function MessageBubble({ msg, currentUserRole, showTime = true }: MessageBubbleProps) {
  const isSender = msg.sender === currentUserRole
  const isCustMsg = msg.sender === 'customer'
  const isAfterSales = msg.msg_type === 'after_sales'
  const isClosed = msg.msg_type === 'after_sales_closed'

  return (
    <div className={cn("flex flex-col", isSender ? "items-end" : "items-start", "mb-4")}>
      {showTime && (
        <div className="text-center w-full my-3">
          <span className="text-[10px] font-bold text-slate-400 bg-slate-200/50 px-3 py-1 rounded-full uppercase tracking-wider">
            {format(new Date(msg.created_at), 'MM-dd HH:mm')}
          </span>
        </div>
      )}
      <div className={cn(
        "max-w-[85%] flex flex-col",
        isSender ? "items-end" : "items-start"
      )}>
        {/* Rating for customer messages */}
        {isCustMsg && msg.rating && (
          <div className="flex gap-0.5 mb-1.5 ml-1 bg-white px-2 py-1 rounded-full shadow-sm border border-slate-100">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star key={i} size={12} fill={i < msg.rating! ? '#f59e0b' : 'none'} color={i < msg.rating! ? '#f59e0b' : '#cbd5e1'} />
            ))}
          </div>
        )}
        
        {/* Bubble */}
        <div className={cn(
          "px-4 py-2.5 shadow-sm relative group overflow-hidden",
          isSender 
            ? "rounded-2xl rounded-tr-sm" 
            : "rounded-2xl rounded-tl-sm border border-slate-100",
          isAfterSales 
            ? (isCustMsg ? "bg-rose-500 text-white" : "bg-rose-50 text-rose-800 border-rose-200") 
            : (isSender ? "bg-orange-500 text-white" : "bg-white text-slate-800")
        )}>
          {/* System status tags inside bubble */}
          {isAfterSales && isCustMsg && (
            <div className="text-xs font-black mb-1 opacity-90">🚨 发起售后争议</div>
          )}
          {isAfterSales && !isCustMsg && (
            <div className="text-[11px] font-black mb-1.5 text-rose-600 flex items-center gap-1 bg-rose-600/10 px-2 py-1 rounded -mx-1">
              <AlertCircle size={14} /> 商家协商确认
            </div>
          )}
          {isClosed && (
            <div className="text-xs font-black mb-1 text-emerald-500">✅ 纠纷已完结</div>
          )}
          
          <div className={cn("text-[14px] leading-relaxed break-words whitespace-pre-wrap", 
            !isCustMsg && isAfterSales && (msg.content.includes('退款') || msg.content.includes('金额')) ? "font-bold" : ""
          )}>
            {msg.content}
          </div>

          {/* Decorator line for merchant after sales msg */}
          {!isCustMsg && isAfterSales && (
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-rose-600" />
          )}
        </div>
        
        {/* Timestamp and read status */}
        <div className="flex items-center gap-1 mt-1.5 px-1">
          <span className="text-[10px] text-slate-400">{format(new Date(msg.created_at), 'HH:mm')}</span>
          {/* Customer views merchant: show "商家/商家处理中" */}
          {currentUserRole === 'customer' && !isCustMsg && (
            <span className={cn("text-[10px] font-semibold ml-1", isAfterSales ? "text-rose-500" : "text-emerald-500")}>
              {isAfterSales ? "商家处理中" : "商家"}
            </span>
          )}
          {/* Merchant views their own message: show read receipt */}
          {currentUserRole === 'merchant' && isSender && msg.is_read_by_customer && (
             <CheckCheck size={14} className="text-emerald-500" />
          )}
        </div>
      </div>
    </div>
  )
}

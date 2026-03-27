import { Badge } from "@/components/ui/badge"
import type { Order } from '@/lib/types'
import { cn, formatPrice, getCountdown, getTimeAgo } from '@/lib/utils'
import { Clock, ChevronRight, AlertCircle, MessageCircle } from 'lucide-react'

const STATUS_LABELS: Record<string, string> = {
  pending: '待处理',
  preparing: '制作中',
  delivering: '配送中',
  completed: '已完成',
  cancelled: '已取消'
}

const STATUS_VARIANTS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  preparing: "default",
  delivering: "default",
  completed: "secondary",
  cancelled: "outline"
}

const STATUS_FLOW = ['pending', 'preparing', 'delivering', 'completed']

interface OrderCardProps {
  order: Order
  isUrgent?: boolean
  isNewMessage?: boolean
  newMessageCount?: number
  isNegotiating?: boolean
  showProgress?: boolean
  opacity?: number
  onClick?: (order: Order) => void
  onStatusUpdate?: (order: Order) => void
}

export default function OrderCard({
  order,
  isUrgent = false,
  isNewMessage = false,
  newMessageCount = 0,
  isNegotiating = false,
  showProgress = false,
  opacity = 1,
  onClick,
  onStatusUpdate
}: OrderCardProps) {
  
  const renderAfterSalesTags = () => {
    if (order.after_sales_status === 'pending') {
      return (
        <Badge variant="destructive" className="animate-pulse gap-1 font-black shadow-sm h-6 px-2">
          <AlertCircle size={10} />
          {['completed', 'cancelled'].includes(order.status) ? '售后申请' : '退单协商'}
          {order.after_sales_urge_count > 0 && ` ×${order.after_sales_urge_count}`}
        </Badge>
      )
    }
    
    if (isNegotiating) {
      return (
        <Badge variant="destructive" className="animate-pulse gap-1 font-black shadow-sm h-6 px-2">
          <MessageCircle size={10} />
          退单协商
        </Badge>
      )
    }
    
    if (isNewMessage) {
      return (
        <div className="relative h-6 min-w-[28px] flex items-center justify-center mr-0.5 transition-transform hover:scale-110 active:scale-95 group/msg">
          <MessageCircle size={18} className="text-blue-500 opacity-90 transition-opacity group-hover/msg:opacity-100" strokeWidth={2.5} />
          {newMessageCount > 0 && (
             <span className="absolute -top-1 -right-1 flex h-3.5 min-w-[14px] items-center justify-center rounded-full bg-blue-600 px-1 text-[8px] font-black text-white ring-2 ring-white shadow-sm animate-pulse">
               {newMessageCount}
             </span>
          )}
        </div>
      )
    }
    return null
  }

  const renderResolvedTags = () => {
    if (order.after_sales_status === 'resolved') {
      return (
        <Badge variant="outline" className="text-blue-600 border-blue-200 bg-blue-50/50 font-bold">
          已售后: 退 {formatPrice(Number(order.refund_amount))}
        </Badge>
      )
    }
    if (order.after_sales_status === 'rejected') {
      return (
        <Badge variant="outline" className="text-slate-500 border-slate-200 bg-slate-50 font-bold">
          已售后: 驳回
        </Badge>
      )
    }
    return null
  }

  return (
    <div 
      className={cn(
        "group relative bg-white rounded-2xl p-4 shadow-sm ring-1 ring-black/5 transition-all duration-300 active:scale-[0.98] select-none",
        onClick ? "cursor-pointer hover:shadow-md hover:ring-orange-200" : "cursor-default",
        isUrgent && "ring-2 ring-rose-300 ring-offset-2 animate-urgent-soft",
        opacity < 1 && "opacity-60"
      )}
      onClick={() => onClick?.(order)}
    >
      {/* 侧边强调条 */}
      {isUrgent && (
        <div className="absolute left-0 top-1/4 bottom-1/4 w-1 bg-rose-500 rounded-r-full shadow-[0_0_12px_rgba(244,63,94,0.5)]" />
      )}

      <div className="flex justify-between items-start gap-4">
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <Badge 
              variant="outline" 
              className={cn(
                "h-5 px-1.5 font-bold text-[10px] uppercase tracking-wider",
                order.order_type === 'personal' 
                  ? "text-orange-500 border-orange-100 bg-orange-50/50" 
                  : "text-blue-500 border-blue-100 bg-blue-50/50"
              )}
            >
              {order.order_type === 'personal' ? '个人' : '公司'}
            </Badge>
            <h3 className="text-base font-black text-slate-900 tracking-tight">
              {order.customer_name}
            </h3>
          </div>
          
          <div className="flex items-center gap-2 text-xs text-slate-400 font-bold">
            <span className="tracking-tight">{order.phone}</span>
            <span className="opacity-20">|</span>
            <span className="text-slate-600 font-black">{formatPrice(Number(order.total_amount))}</span>
          </div>
        </div>
        
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="flex items-center gap-1.5">
            {renderAfterSalesTags()}
            <Badge 
              variant={STATUS_VARIANTS[order.status]} 
              className={cn(
                "h-6 px-2 font-black text-[11px]",
                order.status === 'completed' && "bg-emerald-50 text-emerald-600 border-emerald-100",
                order.status === 'preparing' && "bg-orange-500 text-white",
                order.status === 'delivering' && "bg-blue-500 text-white"
              )}
            >
              {STATUS_LABELS[order.status] || order.status}
            </Badge>
          </div>
          
          {['completed', 'cancelled'].includes(order.status) && (
             <div className="flex flex-col items-end gap-1">
               {renderResolvedTags()}
             </div>
          )}

          <div className="flex items-center gap-1 text-[11px] text-orange-500 font-black">
             <Clock size={12} strokeWidth={3} />
             {showProgress ? getCountdown(order.scheduled_time) : getTimeAgo(order.created_at)}
          </div>
        </div>
      </div>
      
      {showProgress && (
        <div className="mt-4 space-y-4">
          <div className="flex gap-1.5 h-1.5 px-0.5">
            {STATUS_FLOW.map((s, i) => {
              const currentIdx = STATUS_FLOW.indexOf(order.status)
              const isCompleted = currentIdx >= i
              const isActive = order.status === s
              return (
                <div 
                  key={s} 
                  className={cn(
                    "flex-1 rounded-full transition-all duration-500",
                    isCompleted ? "bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.4)]" : "bg-slate-100",
                    isActive && "animate-pulse"
                  )} 
                />
              )
            })}
          </div>
          
          <div className="flex justify-end">
            {order.status !== 'completed' && order.status !== 'cancelled' && order.after_sales_status !== 'pending' && onStatusUpdate && (
              <button
                onClick={(e) => { e.stopPropagation(); onStatusUpdate(order) }}
                className="flex items-center gap-1.5 bg-slate-900 text-white px-4 py-2 rounded-xl text-xs font-black shadow-lg shadow-slate-200 active:scale-95 transition-all"
              >
                {STATUS_LABELS[STATUS_FLOW[STATUS_FLOW.indexOf(order.status) + 1]] || '下一步'}
                <ChevronRight size={14} strokeWidth={3} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

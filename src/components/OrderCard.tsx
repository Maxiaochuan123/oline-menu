'use client'

import type { Order } from '@/lib/types'
import { formatPrice, getCountdown, getTimeAgo } from '@/lib/utils'
import { Clock, ChevronRight } from 'lucide-react'

const STATUS_LABELS: Record<string, string> = {
  pending: '待处理',
  preparing: '制作中',
  delivering: '配送中',
  completed: '已完成',
  cancelled: '已取消'
}

const STATUS_FLOW = ['pending', 'preparing', 'delivering', 'completed']

interface OrderCardProps {
  order: Order
  isUrgent?: boolean
  isNewMessage?: boolean
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
  isNegotiating = false,
  showProgress = false,
  opacity = 1,
  onClick,
  onStatusUpdate
}: OrderCardProps) {
  
  // 决定显示的红蓝色标签逻辑
  const renderAfterSalesTags = () => {
    if (order.after_sales_status === 'pending') {
      return (
        <span className="tag tag-status tag-pulse-red" style={{ transform: showProgress ? 'none' : 'scale(0.95)' }}>
          {['completed', 'cancelled'].includes(order.status) ? '! 请求售后' : '! 退单协商'}
          {order.after_sales_urge_count > 0 && ` (催 ${order.after_sales_urge_count})`}
        </span>
      )
    }
    
    // 如果没有正式处于 pending，再来看是否是协商退单留言
    if (isNegotiating) {
      return <span className="tag tag-status tag-pulse-red" style={{ transform: showProgress ? 'none' : 'scale(0.95)' }}>退单协商</span>
    }
    
    // 最后如果仅仅是普通新消息
    if (isNewMessage) {
      return <span className="tag tag-status tag-pulse-blue" style={{ transform: showProgress ? 'none' : 'scale(0.95)' }}>新消息</span>
    }
    return null
  }

  // 决定显示的已售货结果标签（仅限历史结单区域）
  const renderResolvedTags = () => {
    if (order.after_sales_status === 'resolved') {
      return (
        <span className="tag tag-status" style={{ color: '#2563eb', background: '#eff6ff', border: '1px solid #bfdbfe', marginTop: showProgress ? '6px' : '0' }}>
          已售后: 退 {formatPrice(Number(order.refund_amount))}
        </span>
      )
    }
    if (order.after_sales_status === 'rejected') {
      return (
        <span className="tag tag-status" style={{ color: '#4b5563', background: '#f3f4f6', border: '1px solid #e5e7eb', marginTop: showProgress ? '6px' : '0' }}>
          已售后: 驳回
        </span>
      )
    }
    return null
  }

  const handleCardClick = (e: React.MouseEvent) => {
    if (onClick) onClick(order)
  }

  return (
    <div 
      className={`card animate-fade-in ${isUrgent ? 'urgent-panel-pulse' : ''}`}
      onClick={handleCardClick}
      style={{ 
        cursor: onClick ? 'pointer' : 'default', 
        borderLeft: isUrgent ? '4px solid var(--color-danger)' : '1px solid var(--color-border)',
        marginBottom: '10px',
        opacity: opacity
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px' }}>
            <span className={`tag tag-${order.order_type === 'personal' ? 'personal' : 'company'}`}>
              {order.order_type === 'personal' ? '个人' : '公司'}
            </span>
            <span style={{ fontWeight: showProgress ? '600' : '800', fontSize: '16px' }}>{order.customer_name}</span>
          </div>
          <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
            {order.phone} · {formatPrice(Number(order.total_amount))}
          </div>
        </div>
        
        <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: showProgress ? '6px' : '8px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span className={`tag tag-status tag-${order.status}`} style={{ opacity: opacity < 1 ? 0.7 : 1 }}>
              {STATUS_LABELS[order.status] || order.status}
            </span>
            {renderAfterSalesTags()}
          </div>
          
          {/* 在已完结状态展示退款结果 */}
          {['completed', 'cancelled'].includes(order.status) && (
             <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
               {renderResolvedTags()}
             </div>
          )}

          <div style={{ fontSize: '12px', color: '#f97316', fontWeight: showProgress ? 'normal' : 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
             <Clock size={12} /> {showProgress ? getCountdown(order.scheduled_time) : getTimeAgo(order.created_at)}
          </div>
        </div>
      </div>
      
      {/* ProgressBar 用于订单管理页 */}
      {showProgress && (
        <div style={{ marginTop: '12px' }}>
          <div className="progress-bar">
            {STATUS_FLOW.map((s, i) => (
              <div key={s} className={`progress-step ${STATUS_FLOW.indexOf(order.status) >= i ? 'completed' : ''} ${order.status === s ? 'active' : ''}`} />
            ))}
          </div>
          
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
            {order.status !== 'completed' && order.status !== 'cancelled' && order.after_sales_status !== 'pending' && onStatusUpdate && (
              <button
                onClick={(e) => { e.stopPropagation(); onStatusUpdate(order) }}
                className="btn btn-primary btn-sm"
              >
                {STATUS_LABELS[STATUS_FLOW[STATUS_FLOW.indexOf(order.status) + 1]] || ''}
                <ChevronRight size={14} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

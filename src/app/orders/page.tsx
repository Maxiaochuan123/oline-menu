'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { Merchant, Order, OrderItem } from '@/lib/types'
import { formatPrice, getCountdown, speak, lastFourDigits } from '@/lib/utils'
import { ArrowLeft, Clock, ChevronRight, HelpCircle } from 'lucide-react'
import Link from 'next/link'
import OrderManagerModal from '@/components/OrderManagerModal'

const STATUS_LABELS: Record<string, string> = {
  pending: '待处理', preparing: '制作中', delivering: '配送中', completed: '已完成', cancelled: '已取消'
}
const STATUS_FLOW = ['pending', 'preparing', 'delivering', 'completed']

export default function OrdersPage() {
  const supabase = createClient()
  const router = useRouter()
  const [merchant, setMerchant] = useState<Merchant | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [, setTick] = useState(0)

  const loadData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    const { data: m } = await supabase.from('merchants').select('*').eq('user_id', user.id).single()
    if (!m) return
    setMerchant(m)
    const { data: o } = await supabase.from('orders').select('*').eq('merchant_id', m.id).order('scheduled_time', { ascending: true })
    setOrders(o || [])
    setLoading(false)
  }, [supabase, router])

  useEffect(() => { loadData() }, [loadData])

  // 倒计时刷新
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 60000)
    return () => clearInterval(timer)
  }, [])

  // 实时订阅
  useEffect(() => {
    if (!merchant) return
    const channel = supabase
      .channel('orders-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `merchant_id=eq.${merchant.id}` },
        (payload) => {
          if (payload.eventType === 'INSERT') {
            const newOrder = payload.new as Order
            setOrders(prev => [...prev, newOrder].sort((a, b) => new Date(a.scheduled_time).getTime() - new Date(b.scheduled_time).getTime()))
            speak(`叮！接到来自${lastFourDigits(newOrder.phone)}的订单啦！`)
          } else if (payload.eventType === 'UPDATE') {
            const updated = payload.new as Order
            setOrders(prev => {
              const oldOrder = prev.find(o => o.id === updated.id)
              
              if (oldOrder && oldOrder.status !== 'cancelled' && updated.status === 'cancelled' && updated.cancelled_by === 'customer') {
                setTimeout(() => speak(`${lastFourDigits(updated.phone)}取消订单啦！`), 100)
              }
              
              if (oldOrder && oldOrder.after_sales_status !== 'pending' && updated.after_sales_status === 'pending') {
                setTimeout(() => speak(`尾号 ${lastFourDigits(updated.phone)} 的客户申请了售后 理由是 ${updated.after_sales_reason || '未知'} 请尽快处理！`), 200)
              }

              const oldUrge = oldOrder?.after_sales_urge_count || 0
              const newUrge = updated.after_sales_urge_count || 0
              if (newUrge > oldUrge) {
                setTimeout(() => speak(`尾号 ${lastFourDigits(updated.phone)} 的客户 第 ${newUrge} 次催促您处理售后，请尽快处理！`), 200)
              }
              
              return prev.map(o => o.id === updated.id ? updated : o)
            })
          }
        }
      ).subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [merchant, supabase])

  async function openOrder(order: Order) {
    setSelectedOrder(order)
  }

  function requestStatusUpdate(order: Order) {
    if (order.after_sales_status === 'pending') {
      alert('该订单尚有纠纷未处理完结，请先点击详情查阅并完结售后，再推进订单流程。')
      return
    }
    // 状态推进逻辑不再直接在此处理，交由组件或保留底层刷新
  }

  const loadOrders = () => loadData()

  // 售后相关逻辑已整体移至 OrderManagerModal

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}><span className="spinner" /></div>
  }

  const activeOrders = orders
    .filter(o => !['completed', 'cancelled'].includes(o.status) || o.after_sales_status === 'pending')
    .sort((a, b) => {
      if (a.after_sales_status === 'pending' && b.after_sales_status !== 'pending') return -1;
      if (a.after_sales_status !== 'pending' && b.after_sales_status === 'pending') return 1;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    })
  const historyOrders = orders.filter(o => ['completed', 'cancelled'].includes(o.status) && o.after_sales_status !== 'pending')

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
      <header style={{
        background: 'white', padding: '14px 20px',
        display: 'flex', alignItems: 'center', gap: '10px',
        borderBottom: '1px solid var(--color-border)', position: 'sticky', top: 0, zIndex: 10,
      }}>
        <Link href="/dashboard"><ArrowLeft size={22} color="#1c1917" /></Link>
        <span style={{ fontWeight: '700', fontSize: '17px' }}>订单管理</span>
        <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>({activeOrders.length} 进行中)</span>
      </header>

      <div style={{ padding: '16px 20px 100px' }}>
        {/* 进行中订单 */}
        {activeOrders.length > 0 && (
          <>
            <h3 style={{ fontSize: '14px', fontWeight: '600', color: 'var(--color-text-secondary)', marginBottom: '10px' }}>进行中</h3>
            {activeOrders.map(order => (
              <div key={order.id} className="card animate-fade-in" style={{ marginBottom: '10px', cursor: 'pointer' }} onClick={() => openOrder(order)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '4px' }}>
                      <span className={`tag tag-${order.order_type === 'personal' ? 'personal' : 'company'}`}>
                        {order.order_type === 'personal' ? '个人' : '公司'}
                      </span>
                      <span style={{ fontWeight: '600' }}>{order.customer_name}</span>
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                      {order.phone} · {formatPrice(Number(order.total_amount))}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span className={`tag tag-status tag-${order.status}`}>{STATUS_LABELS[order.status]}</span>
                      {order.after_sales_status === 'pending' && (
                        <span className="tag tag-status tag-pulse-red">
                          {['completed', 'cancelled'].includes(order.status) ? '! 请求售后' : '! 退单协商'}
                          {order.after_sales_urge_count > 0 && ` (催 ${order.after_sales_urge_count})`}
                        </span>
                      )}
                    </div>
                    {order.after_sales_status === 'resolved' && (
                       <div style={{ color: '#15803d', fontSize: '11px', fontWeight: '700', background: '#f0fdf4', padding: '4px 8px', borderRadius: '4px', display: 'inline-block', border: '1px solid #bbf7d0' }}>
                         已售后: 退 {formatPrice(Number(order.refund_amount))}
                       </div>
                    )}
                    {order.after_sales_status === 'rejected' && (
                       <div style={{ color: '#666', fontSize: '11px', fontWeight: '700', background: '#f3f4f6', padding: '4px 8px', borderRadius: '4px', display: 'inline-block', border: '1px solid #e5e7eb' }}>
                         已售后: 驳回
                       </div>
                    )}

                    <div style={{ fontSize: '12px', color: '#f97316', display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-end' }}>
                      <Clock size={12} /> {getCountdown(order.scheduled_time)}
                    </div>
                  </div>
                </div>
                {/* 进度条 */}
                <div className="progress-bar">
                  {STATUS_FLOW.map((s, i) => (
                    <div key={s} className={`progress-step ${STATUS_FLOW.indexOf(order.status) >= i ? 'completed' : ''} ${order.status === s ? 'active' : ''}`} />
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
                  {order.status !== 'completed' && order.status !== 'cancelled' && order.after_sales_status !== 'pending' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); requestStatusUpdate(order) }}
                      className="btn btn-primary btn-sm"
                    >
                      {STATUS_LABELS[STATUS_FLOW[STATUS_FLOW.indexOf(order.status) + 1]] || ''}
                      <ChevronRight size={14} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </>
        )}

        {/* 历史订单 */}
        {historyOrders.length > 0 && (
          <>
            <h3 style={{ fontSize: '14px', fontWeight: '600', color: 'var(--color-text-secondary)', margin: '20px 0 10px' }}>历史订单</h3>
            {historyOrders.slice(0, 20).map(order => (
              <div key={order.id} className="card" style={{ marginBottom: '8px', cursor: 'pointer', opacity: 0.7 }} onClick={() => openOrder(order)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <span style={{ fontWeight: '600' }}>{order.customer_name}</span>
                    <span style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginLeft: '8px' }}>{formatPrice(Number(order.total_amount))}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                      <span className={`tag tag-status tag-${order.status}`}>{STATUS_LABELS[order.status]}</span>
                      {order.after_sales_status === 'pending' && (
                        <span className="tag tag-status tag-pulse-red">! 请求售后</span>
                      )}
                      {order.after_sales_status === 'resolved' && (
                         <span className="tag tag-status" style={{ color: '#2563eb', background: '#eff6ff', border: '1px solid #bfdbfe' }}>
                           已售后: 退 {formatPrice(Number(order.refund_amount))}
                         </span>
                      )}
                      {order.after_sales_status === 'rejected' && (
                         <span className="tag tag-status" style={{ color: '#4b5563', background: '#f3f4f6', border: '1px solid #e5e7eb' }}>
                           已售后: 驳回
                         </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </>
        )}

        {orders.length === 0 && (
          <div className="empty-state">
            <Clock />
            <p>暂无订单</p>
          </div>
        )}
      </div>

      <OrderManagerModal 
        order={selectedOrder} 
        onClose={() => setSelectedOrder(null)} 
        onSuccess={() => {
          setSelectedOrder(null)
          loadOrders()
        }}
      />
    </div>
  )
}

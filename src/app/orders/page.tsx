'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { Merchant, Order, OrderItem } from '@/lib/types'
import { formatPrice, getCountdown, speak, lastFourDigits } from '@/lib/utils'
import { ArrowLeft, Clock, ChevronRight, X, AlertTriangle } from 'lucide-react'
import Link from 'next/link'

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
  const [orderItems, setOrderItems] = useState<OrderItem[]>([])
  const [showCancel, setShowCancel] = useState(false)
  const [pendingStatusOrder, setPendingStatusOrder] = useState<Order | null>(null)
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
            setOrders(prev => prev.map(o => o.id === updated.id ? updated : o))
            if (updated.status === 'cancelled' && updated.cancelled_by === 'customer') {
              speak(`${lastFourDigits(updated.phone)}取消订单啦！`)
            }
          }
        }
      ).subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [merchant, supabase])

  async function openOrder(order: Order) {
    setSelectedOrder(order)
    const { data } = await supabase.from('order_items').select('*').eq('order_id', order.id)
    setOrderItems(data || [])
  }

  async function updateStatus(order: Order) {
    const idx = STATUS_FLOW.indexOf(order.status)
    if (idx < 0 || idx >= STATUS_FLOW.length - 1) return
    const nextStatus = STATUS_FLOW[idx + 1]

    await supabase.from('orders').update({ status: nextStatus }).eq('id', order.id)

    // 如果完成，更新客户统计
    if (nextStatus === 'completed' && order.customer_id) {
      const { data: customer } = await supabase.from('customers').select('*').eq('id', order.customer_id).single()
      if (customer) {
        await supabase.from('customers').update({
          order_count: customer.order_count + 1,
          total_spent: Number(customer.total_spent) + Number(order.total_amount),
          points: customer.points + Math.floor(Number(order.total_amount)),
        }).eq('id', customer.id)
      }
    }

    loadData()
    if (selectedOrder?.id === order.id) {
      setSelectedOrder({ ...order, status: nextStatus as Order['status'] })
    }
    setPendingStatusOrder(null)
  }

  function requestStatusUpdate(order: Order) {
    const idx = STATUS_FLOW.indexOf(order.status)
    if (idx < 0 || idx >= STATUS_FLOW.length - 1) return
    setPendingStatusOrder(order)
  }

  async function cancelOrder() {
    if (!selectedOrder) return
    await supabase.from('orders').update({
      status: 'cancelled',
      cancelled_by: 'merchant',
      cancelled_at: new Date().toISOString(),
      refund_amount: selectedOrder.total_amount,
    }).eq('id', selectedOrder.id)
    setShowCancel(false)
    setSelectedOrder(null)
    loadData()
  }

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}><span className="spinner" /></div>
  }

  const activeOrders = orders.filter(o => !['completed', 'cancelled'].includes(o.status))
  const historyOrders = orders.filter(o => ['completed', 'cancelled'].includes(o.status))

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
                  <div style={{ textAlign: 'right' }}>
                    <span className={`tag tag-status tag-${order.status}`}>{STATUS_LABELS[order.status]}</span>
                    <div style={{ fontSize: '12px', color: '#f97316', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px', justifyContent: 'flex-end' }}>
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
                  {order.status !== 'completed' && order.status !== 'cancelled' && (
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
                  <span className={`tag tag-status tag-${order.status}`}>{STATUS_LABELS[order.status]}</span>
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

      {/* 订单详情弹窗 */}
      {selectedOrder && (
        <>
          <div className="overlay" onClick={() => setSelectedOrder(null)} />
          <div className="dialog">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h3 style={{ fontWeight: '700' }}>订单详情</h3>
              <button onClick={() => setSelectedOrder(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
            </div>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
              <span className={`tag tag-${selectedOrder.order_type === 'personal' ? 'personal' : 'company'}`}>
                {selectedOrder.order_type === 'personal' ? '个人' : '公司'}
              </span>
              <span className={`tag tag-status tag-${selectedOrder.status}`}>{STATUS_LABELS[selectedOrder.status]}</span>
            </div>
            <div style={{ fontSize: '14px', lineHeight: '2' }}>
              <div><strong>客户：</strong>{selectedOrder.customer_name}</div>
              <div><strong>电话：</strong>{selectedOrder.phone}</div>
              <div><strong>地址：</strong>{selectedOrder.address}</div>
              <div><strong>预定时间：</strong>{new Date(selectedOrder.scheduled_time).toLocaleString('zh-CN')}</div>
            </div>
            <div style={{ margin: '12px 0', borderTop: '1px solid var(--color-border)', paddingTop: '12px' }}>
              <strong style={{ fontSize: '14px' }}>菜品明细：</strong>
              {orderItems.map(item => (
                <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', padding: '4px 0' }}>
                  <span>{item.item_name} x{item.quantity} {item.remark ? `(${item.remark})` : ''}</span>
                  <span>{formatPrice(item.item_price * item.quantity)}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: '700', fontSize: '16px', marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed var(--color-border)' }}>
                <span>合计</span>
                <span style={{ color: '#f97316' }}>{formatPrice(Number(selectedOrder.total_amount))}</span>
              </div>
            </div>
            {!['completed', 'cancelled'].includes(selectedOrder.status) && (
              <div style={{ display: 'flex', gap: '8px', marginTop: '16px' }}>
                <button onClick={() => setShowCancel(true)} className="btn btn-danger btn-sm" style={{ flex: 1 }}>取消订单</button>
                <button onClick={() => requestStatusUpdate(selectedOrder)} className="btn btn-primary" style={{ flex: 2 }}>
                  {STATUS_LABELS[STATUS_FLOW[STATUS_FLOW.indexOf(selectedOrder.status) + 1]] || ''}
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>
        </>
      )}

      {/* 取消确认弹窗 */}
      {showCancel && (
        <>
          <div className="overlay" style={{ zIndex: 60 }} onClick={() => setShowCancel(false)} />
          <div className="dialog" style={{ zIndex: 70 }}>
            <div style={{ textAlign: 'center' }}>
              <AlertTriangle size={48} color="#ef4444" style={{ margin: '0 auto 12px' }} />
              <h3 style={{ fontWeight: '700', marginBottom: '8px' }}>确认取消订单？</h3>
              <p style={{ fontSize: '14px', color: 'var(--color-text-secondary)' }}>
                商家取消订单将全额退款给客户，此操作不可撤销。
              </p>
              <div style={{ display: 'flex', gap: '8px', marginTop: '20px' }}>
                <button onClick={() => setShowCancel(false)} className="btn btn-outline" style={{ flex: 1 }}>再想想</button>
                <button onClick={cancelOrder} className="btn btn-danger" style={{ flex: 1 }}>确认取消</button>
              </div>
            </div>
          </div>
        </>
      )}
      {/* 推进状态二次确认弹窗 */}
      {pendingStatusOrder && (() => {
        const idx = STATUS_FLOW.indexOf(pendingStatusOrder.status)
        const nextStatus = STATUS_FLOW[idx + 1]
        return (
          <>
            <div className="overlay" style={{ zIndex: 80 }} onClick={() => setPendingStatusOrder(null)} />
            <div className="dialog" style={{ zIndex: 90 }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  width: '56px', height: '56px', borderRadius: '50%',
                  background: '#fff7ed', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 14px'
                }}>
                  <AlertTriangle size={28} color="#f97316" />
                </div>
                <h3 style={{ fontWeight: '800', marginBottom: '10px' }}>确认更新状态？</h3>
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  gap: '10px', margin: '14px 0', fontSize: '15px'
                }}>
                  <span style={{
                    padding: '4px 12px', borderRadius: '20px',
                    background: '#f5f5f4', fontWeight: '600', color: '#78716c'
                  }}>{STATUS_LABELS[pendingStatusOrder.status]}</span>
                  <ChevronRight size={18} color="#f97316" />
                  <span style={{
                    padding: '4px 12px', borderRadius: '20px',
                    background: '#fff7ed', fontWeight: '700', color: '#ea580c',
                    border: '1px solid #fed7aa'
                  }}>{STATUS_LABELS[nextStatus]}</span>
                </div>
                <p style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginBottom: '20px' }}>
                  {pendingStatusOrder.customer_name} · {formatPrice(Number(pendingStatusOrder.total_amount))}
                </p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => setPendingStatusOrder(null)} className="btn btn-outline" style={{ flex: 1 }}>再想想</button>
                  <button onClick={() => updateStatus(pendingStatusOrder)} className="btn btn-primary" style={{ flex: 1 }}>确认</button>
                </div>
              </div>
            </div>
          </>
        )
      })()}
    </div>
  )
}

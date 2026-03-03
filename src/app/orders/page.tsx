'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { Merchant, Order } from '@/lib/types'
import { lastFourDigits } from '@/lib/utils'
import { ArrowLeft, Clock } from 'lucide-react'
import Link from 'next/link'
import OrderManagerModal from '@/components/OrderManagerModal'
import OrderCard from '@/components/OrderCard'



export default function OrdersPage() {
  const supabase = createClient()
  const router = useRouter()
  const [merchant, setMerchant] = useState<Merchant | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [, setTick] = useState(0)

  // 补回缺漏的语音提示方法
  const speak = useCallback((text: string) => {
    if ('speechSynthesis' in window) {
      const msg = new SpeechSynthesisUtterance(text)
      msg.lang = 'zh-CN'
      msg.rate = 1.1
      window.speechSynthesis.speak(msg)
    }
  }, [])

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
  }, [merchant, supabase, speak])

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
              <OrderCard
                key={order.id}
                order={order}
                isUrgent={order.after_sales_status === 'pending'}
                showProgress={true}
                onClick={openOrder}
                onStatusUpdate={requestStatusUpdate}
              />
            ))}
          </>
        )}

        {/* 历史订单 */}
        {historyOrders.length > 0 && (
          <>
            <h3 style={{ fontSize: '14px', fontWeight: '600', color: 'var(--color-text-secondary)', margin: '20px 0 10px' }}>历史订单</h3>
            {historyOrders.slice(0, 20).map(order => (
              <OrderCard
                key={order.id}
                order={order}
                opacity={0.65}
                onClick={openOrder}
              />
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

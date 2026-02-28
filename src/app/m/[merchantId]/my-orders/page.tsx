'use client'

import { useState, useEffect, use } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Order } from '@/lib/types'
import { formatPrice } from '@/lib/utils'
import { ArrowLeft, Clock, Package } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  pending:    { label: '待收单', color: '#f59e0b', bg: '#fef3c7' },
  preparing:  { label: '制作中', color: '#3b82f6', bg: '#eff6ff' },
  delivering: { label: '配送中', color: '#8b5cf6', bg: '#f3e8ff' },
  completed:  { label: '已完成', color: '#10b981', bg: '#d1fae5' },
  cancelled:  { label: '已取消', color: '#6b7280', bg: '#f3f4f6' },
}

export default function MyOrdersPage({ params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = use(params)
  const supabase = createClient()
  const router = useRouter()

  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [phone, setPhone] = useState<string | null>(null)

  async function loadOrders(ph: string) {
    const { data } = await supabase
      .from('orders')
      .select('*')
      .eq('merchant_id', merchantId)
      .eq('phone', ph)
      .order('created_at', { ascending: false })
      .limit(30)
    setOrders(data || [])
    setLoading(false)
  }

  useEffect(() => {
    const info = localStorage.getItem(`customer_info_${merchantId}`)
    if (!info) { setLoading(false); return }
    try {
      const parsed = JSON.parse(info)
      const ph = parsed.phone as string
      setPhone(ph)
      loadOrders(ph)
    } catch {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchantId])

  // 实时订阅进行中订单状态
  useEffect(() => {
    if (!phone) return
    const channel = supabase
      .channel('my-orders-realtime')
      .on('postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders' },
        (payload) => {
          setOrders(prev => prev.map(o => o.id === payload.new.id ? payload.new as Order : o))
        }
      ).subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [phone, supabase])

  const activeOrders = orders.filter(o => !['completed', 'cancelled'].includes(o.status))
  const historyOrders = orders.filter(o => ['completed', 'cancelled'].includes(o.status))

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
      <span className="spinner" />
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
      <header style={{
        background: 'white', padding: '14px 20px',
        display: 'flex', alignItems: 'center', gap: '10px',
        borderBottom: '1px solid var(--color-border)',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <button onClick={() => router.back()} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          <ArrowLeft size={22} color="#1c1917" />
        </button>
        <span style={{ fontWeight: '700', fontSize: '17px' }}>我的订单</span>
      </header>

      <div style={{ padding: '16px 20px 40px' }}>
        {!phone ? (
          <div className="empty-state">
            <Package />
            <p>还没有下过单哦</p>
            <Link href={`/m/${merchantId}`} className="btn btn-primary" style={{ marginTop: '16px' }}>去点菜</Link>
          </div>
        ) : orders.length === 0 ? (
          <div className="empty-state">
            <Package />
            <p>暂无订单记录</p>
            <Link href={`/m/${merchantId}`} className="btn btn-primary" style={{ marginTop: '16px' }}>去点菜</Link>
          </div>
        ) : (
          <>
            {/* 进行中 */}
            {activeOrders.length > 0 && (
              <>
                <h3 style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: '600', marginBottom: '10px' }}>进行中</h3>
                {activeOrders.map(order => (
                  <OrderCard key={order.id} order={order} merchantId={merchantId} />
                ))}
              </>
            )}

            {/* 历史 */}
            {historyOrders.length > 0 && (
              <>
                <h3 style={{ fontSize: '13px', color: 'var(--color-text-secondary)', fontWeight: '600', margin: '20px 0 10px' }}>历史订单</h3>
                {historyOrders.map(order => (
                  <OrderCard key={order.id} order={order} merchantId={merchantId} />
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function OrderCard({ order, merchantId }: { order: Order; merchantId: string }) {
  const st = STATUS_MAP[order.status] || STATUS_MAP.pending
  const isActive = !['completed', 'cancelled'].includes(order.status)

  return (
    <Link href={`/m/${merchantId}/order/${order.id}`} style={{ textDecoration: 'none' }}>
      <div className="card animate-fade-in" style={{
        marginBottom: '10px', cursor: 'pointer',
        opacity: isActive ? 1 : 0.7,
        borderLeft: isActive ? `3px solid ${st.color}` : '3px solid #e5e7eb',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontWeight: '700', fontSize: '15px', marginBottom: '4px' }}>
              {order.customer_name}
            </div>
            <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Clock size={12} />
              {new Date(order.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{
              display: 'inline-block', padding: '3px 10px', borderRadius: '20px',
              fontSize: '12px', fontWeight: '700',
              color: st.color, background: st.bg,
              marginBottom: '4px',
            }}>
              {st.label}
            </div>
            <div style={{ fontSize: '15px', fontWeight: '800', color: '#111827' }}>
              {formatPrice(Number(order.total_amount))}
            </div>
          </div>
        </div>
      </div>
    </Link>
  )
}

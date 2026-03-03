'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Order, Merchant } from '@/lib/types'
import { formatPrice } from '@/lib/utils'
import { ArrowLeft, Clock, ShoppingBag, MapPin, ChevronRight, User } from 'lucide-react'
import Link from 'next/link'

const STATUS_MAP: Record<string, { label: string, color: string, bg: string }> = {
  pending: { label: '待接单', color: '#f59e0b', bg: '#fef3c7' },     // 高亮橙黄
  preparing: { label: '制作中', color: '#3b82f6', bg: '#eff6ff' },    // 明亮蓝
  delivering: { label: '配送中', color: '#8b5cf6', bg: '#f3e8ff' },   // 活泼紫
  completed: { label: '已完成', color: '#10b981', bg: '#d1fae5' },    // 生态绿
  cancelled: { label: '已取消', color: '#6b7280', bg: '#f3f4f6' }     // 中性灰
}

export default function CustomerOrdersPage({ params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = use(params)
  const supabase = createClient()
  const router = useRouter()

  const [orders, setOrders] = useState<any[]>([])
  const [merchant, setMerchant] = useState<Partial<Merchant> | null>(null)
  const [loading, setLoading] = useState(true)
  const [customerInfo, setCustomerInfo] = useState<{name: string, phone: string} | null>(null)

  useEffect(() => {
    const infoStr = localStorage.getItem(`customer_info_${merchantId}`)
    if (infoStr) {
      try {
        const info = JSON.parse(infoStr)
        setCustomerInfo(info)
        loadOrders(info.phone)
      } catch {
        setLoading(false)
      }
    } else {
      setLoading(false)
    }

    supabase.from('merchants').select('shop_name').eq('id', merchantId).single().then(({ data }) => setMerchant(data))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchantId])

  async function loadOrders(phone: string) {
    const { data } = await supabase
      .from('orders')
      .select('*, order_items(item_name, quantity, item_price)')
      .eq('merchant_id', merchantId)
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(50) // 最多加载50条近期

    if (data) setOrders(data)
    setLoading(false)
  }

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#f8f9fa' }}>
      <span className="spinner" />
    </div>
  )

  if (!customerInfo) return (
    <div style={{ minHeight: '100vh', background: '#f8f9fa', display: 'flex', flexDirection: 'column' }}>
      <header style={{ padding: '14px 16px', background: 'white', display: 'flex', alignItems: 'center', gap: '12px', borderBottom: '1px solid #f5f5f4' }}>
        <button onClick={() => router.push(`/m/${merchantId}`)} style={{ background: 'none', border: 'none', display: 'flex', alignItems: 'center' }}>
          <ArrowLeft size={20} />
        </button>
        <h1 style={{ fontSize: '16px', fontWeight: 'bold' }}>我的订单</h1>
      </header>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 20px', textAlign: 'center' }}>
        <User size={48} color="#d1d5db" style={{ marginBottom: '16px' }} />
        <h2 style={{ fontSize: '18px', fontWeight: 'bold', color: '#4b5563', marginBottom: '8px' }}>暂未登录</h2>
        <p style={{ fontSize: '14px', color: '#9ca3af', marginBottom: '24px' }}>您需要先点餐一次，或通过主页进行登录才能查看历史订单。</p>
        <button className="btn btn-primary" onClick={() => router.push(`/m/${merchantId}`)} style={{ padding: '0 32px', height: '44px', borderRadius: '22px' }}>
          去点餐
        </button>
      </div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: '#f8f9fa', paddingBottom: '40px' }}>
      <header style={{ 
        padding: '14px 16px', background: 'white', display: 'flex', alignItems: 'center', gap: '12px', 
        borderBottom: '1px solid #f5f5f4', position: 'sticky', top: 0, zIndex: 10 
      }}>
        <button onClick={() => router.push(`/m/${merchantId}`)} style={{ background: 'none', border: 'none', display: 'flex', alignItems: 'center' }}>
          <ArrowLeft size={20} />
        </button>
        <h1 style={{ fontSize: '16px', fontWeight: 'bold', flex: 1 }}>历史订单</h1>
      </header>

      <div style={{ padding: '16px' }}>
        {orders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: '#9ca3af' }}>
            <ShoppingBag size={48} color="#e5e7eb" style={{ margin: '0 auto 16px' }} />
            <p style={{ fontSize: '14px' }}>您还没有下过单，快去品尝美味吧~</p>
            <button className="btn btn-outline" style={{ marginTop: '20px', borderRadius: '20px', padding: '0 24px' }} onClick={() => router.push(`/m/${merchantId}`)}>
              返回主页
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {orders.map(order => {
              const st = STATUS_MAP[order.status] || STATUS_MAP['pending']
              const items = order.order_items || []
              let itemNameSummary = items.slice(0, 3).map((i: any) => i.item_name).join('、')
              if (items.length > 3) itemNameSummary += ' 等'
              const totalCount = items.reduce((acc: number, cur: any) => acc + cur.quantity, 0)
              
              return (
                <div 
                  key={order.id} 
                  onClick={() => router.push(`/m/${merchantId}/order/${order.id}`)}
                  style={{ 
                    background: 'white', borderRadius: '12px', padding: '16px', 
                    boxShadow: '0 2px 8px rgba(0,0,0,0.04)', cursor: 'pointer' 
                  }}
                >
                  {/* Top Bar */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f5f5f4', paddingBottom: '12px', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <span style={{ fontSize: '14px', fontWeight: '600', color: '#374151' }}>{merchant?.shop_name || '本店'}</span>
                      <ChevronRight size={14} color="#9ca3af" />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      {order.after_sales_status !== 'none' && (
                        <span style={{ fontSize: '11px', color: '#ef4444', border: '1px solid #fca5a5', padding: '2px 6px', borderRadius: '4px' }}>
                          售后
                        </span>
                      )}
                      <span style={{ fontSize: '13px', fontWeight: 'bold', color: st.color, background: st.bg, padding: '4px 8px', borderRadius: '6px' }}>
                        {st.label}
                      </span>
                    </div>
                  </div>

                  {/* Order Items Summary */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                    <div style={{ flex: 1, paddingRight: '16px' }}>
                      <div style={{ fontSize: '14px', color: '#4b5563', marginBottom: '6px', lineHeight: '1.4' }}>
                        {itemNameSummary || '外卖订单'}
                      </div>
                      <div style={{ fontSize: '12px', color: '#9ca3af', display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Clock size={12} /> {new Date(order.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div style={{ fontSize: '16px', fontWeight: '800', color: '#111827' }}>
                        {formatPrice(Number(order.total_amount))}
                      </div>
                      <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '2px' }}>
                        共 {totalCount} 件
                      </div>
                    </div>
                  </div>

                  {/* Buttons */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                    {order.status === 'completed' && order.after_sales_status === 'none' && (
                      <button className="btn btn-outline btn-sm" style={{ padding: '0 12px', height: '30px', borderRadius: '15px', color: '#4b5563', borderColor: '#d1d5db' }}>
                        再来一单
                      </button>
                    )}
                    {['pending', 'preparing', 'delivering'].includes(order.status) && (
                      <button className="btn btn-primary btn-sm" style={{ padding: '0 12px', height: '30px', borderRadius: '15px' }}>
                        跟踪状态
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

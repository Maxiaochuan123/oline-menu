'use client'

import { useState, useEffect, use } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { Order, Merchant, OrderItem } from '@/lib/types'
import { cn } from '@/lib/utils'
import { ArrowLeft, Clock, ShoppingBag, ChevronRight, User } from 'lucide-react'
import Link from 'next/link'

interface OrderWithItems extends Order {
  order_items?: Pick<OrderItem, 'item_name' | 'quantity' | 'item_price'>[]
}

const STATUS_MAP: Record<string, { label: string, color: string, bg: string }> = {
  pending: { label: '待接单', color: 'text-orange-600', bg: 'bg-orange-100' },     
  preparing: { label: '制作中', color: 'text-blue-600', bg: 'bg-blue-100' },    
  delivering: { label: '配送中', color: 'text-purple-600', bg: 'bg-purple-100' },   
  completed: { label: '已完成', color: 'text-emerald-600', bg: 'bg-emerald-100' },    
  cancelled: { label: '已取消', color: 'text-slate-500', bg: 'bg-slate-100' }     
}

export default function CustomerOrdersPage({ params }: { params: Promise<{ merchantId: string }> }) {
  const { merchantId } = use(params)
  const supabase = createClient()

  const [orders, setOrders] = useState<OrderWithItems[]>([])
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
      .limit(50)

    if (data) setOrders(data as unknown as OrderWithItems[])
    setLoading(false)
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50/50">
      <div className="spinner border-orange-500" />
    </div>
  )

  if (!customerInfo) return (
    <div className="min-h-[100dvh] bg-slate-50 font-sans flex flex-col">
      <header className="bg-white/80 backdrop-blur-md px-5 h-14 flex items-center gap-4 border-b border-slate-100 shrink-0 sticky top-0 z-10">
        <Link href={`/m/${merchantId}`} className="p-2 -ml-2 hover:bg-slate-100 rounded-full transition-colors">
          <ArrowLeft size={20} className="text-slate-600" />
        </Link>
        <h1 className="text-base font-black text-slate-900 tracking-tight leading-none">我的订单</h1>
      </header>
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
        <div className="size-20 bg-slate-100 rounded-full flex items-center justify-center mb-5 ring-8 ring-slate-50">
          <User size={40} className="text-slate-300" />
        </div>
        <h2 className="text-lg font-black text-slate-700 mb-2">暂未登录</h2>
        <p className="text-sm text-slate-400 font-medium mb-8">您需要先点餐一次，或通过主页进行登录才能查看历史订单。</p>
        <Link 
          href={`/m/${merchantId}`}
          className="bg-orange-500 text-white font-black px-10 py-3.5 rounded-full shadow-lg shadow-orange-200 active:scale-95 transition-transform" 
        >
          去点餐
        </Link>
      </div>
    </div>
  )

  return (
    <div className="min-h-[100dvh] bg-slate-50 font-sans pb-10">
      <header className="bg-white/80 backdrop-blur-md px-5 h-14 flex items-center gap-4 border-b border-slate-100 shrink-0 sticky top-0 z-10">
        <Link href={`/m/${merchantId}`} className="p-2 -ml-2 hover:bg-slate-100 rounded-full transition-colors">
          <ArrowLeft size={20} className="text-slate-600" />
        </Link>
        <h1 className="text-base font-black text-slate-900 tracking-tight leading-none">历史订单</h1>
      </header>

      <div className="p-4 max-w-2xl mx-auto">
        {orders.length === 0 ? (
          <div className="text-center py-20 flex flex-col items-center">
            <div className="size-20 bg-slate-100 rounded-full flex items-center justify-center mb-5 ring-8 ring-slate-50">
              <ShoppingBag size={40} className="text-slate-300" />
            </div>
            <p className="text-sm font-bold text-slate-400">您还没有下过单，快去品尝美味吧~</p>
            <Link 
              href={`/m/${merchantId}`}
              className="mt-8 bg-white border border-slate-200 text-slate-600 font-black px-8 py-3 rounded-full shadow-sm active:scale-95 transition-transform hover:bg-slate-50" 
            >
              返回主页
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {orders.map(order => {
              const st = STATUS_MAP[order.status] || STATUS_MAP['pending']
              const items = order.order_items || []
              let itemNameSummary = items.slice(0, 3).map((i) => i.item_name).join('、')
              if (items.length > 3) itemNameSummary += ' 等'
              const totalCount = items.reduce((acc, cur) => acc + cur.quantity, 0)
              
              return (
                <Link 
                  key={order.id} 
                  href={`/m/${merchantId}/order/${order.id}`}
                  className="block bg-white rounded-3xl p-5 shadow-sm border border-slate-100 active:scale-[0.98] transition-transform"
                >
                  {/* Top Bar */}
                  <div className="flex justify-between items-center border-b border-slate-50 pb-3 mb-3">
                    <div className="flex items-center gap-1.5">
                      <span className="font-black text-[15px] text-slate-800">{merchant?.shop_name || '本店'}</span>
                      <ChevronRight size={14} className="text-slate-400" />
                    </div>
                    <div className="flex items-center gap-2">
                      {order.after_sales_status !== 'none' && (
                        <span className="text-[10px] font-black text-rose-500 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-md">
                          售后
                        </span>
                      )}
                      <span className={cn("text-xs font-black px-2 py-1 rounded-lg", st.color, st.bg)}>
                        {st.label}
                      </span>
                    </div>
                  </div>

                  {/* Order Items Summary */}
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex-1 pr-4">
                      <div className="text-[15px] font-bold text-slate-700 mb-1.5 leading-snug line-clamp-2">
                        {itemNameSummary || '外卖订单'}
                      </div>
                      <div className="text-[11px] text-slate-400 font-medium flex items-center gap-1">
                        <Clock size={12} /> {new Date(order.created_at).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="text-lg font-black text-slate-900 leading-none">
                        <span className="text-sm mr-0.5">¥</span>{Number(order.total_amount).toFixed(2)}
                      </div>
                      <div className="text-[11px] text-slate-400 font-bold mt-1.5">
                        共 {totalCount} 件
                      </div>
                    </div>
                  </div>

                  {/* Buttons */}
                  <div className="flex justify-end gap-2">
                    {order.status === 'completed' && order.after_sales_status === 'none' && (
                      <div className="px-4 py-1.5 rounded-full text-xs font-black border border-slate-200 text-slate-600 bg-white shadow-sm">
                        再来一单
                      </div>
                    )}
                    {['pending', 'preparing', 'delivering'].includes(order.status) && (
                      <div className="px-4 py-1.5 rounded-full text-xs font-black bg-orange-500 text-white shadow-md shadow-orange-200">
                        跟踪状态
                      </div>
                    )}
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

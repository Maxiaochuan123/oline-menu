'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { Merchant, Order } from '@/lib/types'
import { lastFourDigits } from '@/lib/utils'
import { ArrowLeft, Clock, Search, User, ChevronDown, ChevronUp, ShoppingBag, History, ChevronRight, MapPin } from 'lucide-react'
import Link from 'next/link'
import OrderManagerModal from '@/components/OrderManagerModal'
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent } from "@/components/ui/card"
import { cn, formatPrice } from '@/lib/utils'



export default function OrdersPage() {
  const supabase = createClient()
  const router = useRouter()
  const [merchant, setMerchant] = useState<Merchant | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expandedPhones, setExpandedPhones] = useState<Set<string>>(new Set())
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

  const loadOrders = () => loadData()

  // 售后相关逻辑已整体移至 OrderManagerModal

  const toggleExpand = (phone: string) => {
    setExpandedPhones(prev => {
      const next = new Set(prev)
      if (next.has(phone)) next.delete(phone)
      else next.add(phone)
      return next
    })
  }

  // --- 状态工具 ---
  const STATUS_LABELS: Record<string, string> = {
    pending: '待处理',
    preparing: '制作中',
    delivering: '配送中',
    completed: '已完成',
    cancelled: '已取消'
  }
  const STATUS_COLORS: Record<string, string> = {
    pending: "bg-amber-100 text-amber-700",
    preparing: "bg-blue-100 text-blue-700",
    delivering: "bg-purple-100 text-purple-700",
    completed: "bg-emerald-100 text-emerald-700",
    cancelled: "bg-zinc-100 text-zinc-700",
  }

  // --- 数据分组逻辑 ---
  const orderGroups = orders.reduce((acc, order) => {
    if (!acc[order.phone]) {
      acc[order.phone] = {
        phone: order.phone,
        name: order.customer_name,
        orders: [],
        hasActive: false,
        hasUrgent: false
      }
    }
    acc[order.phone].orders.push(order)
    if (!['completed', 'cancelled'].includes(order.status) || order.after_sales_status === 'pending') {
      acc[order.phone].hasActive = true
    }
    if (order.after_sales_status === 'pending') {
      acc[order.phone].hasUrgent = true
    }
    return acc
  }, {} as Record<string, { phone: string, name: string, orders: Order[], hasActive: boolean, hasUrgent: boolean }>)

  // 排序并转换数组
  const sortedGroups = Object.values(orderGroups)
    .map(group => ({
      ...group,
      orders: group.orders.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
      latest: group.orders.reduce((prev, curr) => new Date(curr.created_at) > new Date(prev.created_at) ? curr : prev)
    }))
    .filter(g => g.name.toLowerCase().includes(search.toLowerCase()) || g.phone.includes(search))
    .sort((a, b) => {
      // 优待售后申请
      if (a.hasUrgent && !b.hasUrgent) return -1
      if (!a.hasUrgent && b.hasUrgent) return 1
      // 其次是进行中任务
      if (a.hasActive && !b.hasActive) return -1
      if (!a.hasActive && b.hasActive) return 1
      // 最后按最新订单时间
      return new Date(b.latest.created_at).getTime() - new Date(a.latest.created_at).getTime()
    })

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="spinner" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50/50 font-sans pb-20 text-slate-900">
      {/* 顶部导航 */}
      <header className="fixed top-0 left-0 right-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-100 flex items-center gap-4 px-5 py-3 shadow-sm shadow-black/5">
        <Link href="/dashboard" className="p-2 -ml-2 hover:bg-slate-100 rounded-full transition-colors">
          <ArrowLeft size={20} className="text-slate-600" />
        </Link>
        <div className="flex flex-col">
          <h1 className="text-base font-black tracking-tight leading-none">订单管理</h1>
        </div>
      </header>

      <main className="pt-20 px-5 max-w-2xl mx-auto space-y-4">
        {/* 搜索栏 */}
        <div className="sticky top-16 z-30 py-2 bg-slate-50/50 backdrop-blur-sm -mx-5 px-5">
          <div className="relative group">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-orange-500 transition-colors" />
            <Input 
              placeholder="搜索下单人姓名、手机号..." 
              value={search} 
              onChange={e => setSearch(e.target.value)}
              className="h-12 pl-10 pr-4 rounded-[1.5rem] bg-white border-slate-100 shadow-sm focus-visible:ring-orange-500 transition-all font-bold placeholder:font-medium"
            />
          </div>
        </div>

        {/* 订单分组列表 */}
        {sortedGroups.map(group => {
          const isExpanded = expandedPhones.has(group.phone)
          return (
            <Card key={group.phone} className={cn(
              "overflow-hidden border-none shadow-sm ring-1 ring-black/5 transition-all",
              group.hasUrgent ? "ring-rose-200 bg-rose-50/20" : "bg-white"
            )}>
              <CardContent className="p-0">
                {/* 用户摘要头部 */}
                <div 
                  onClick={() => toggleExpand(group.phone)}
                  className="p-4 flex items-center gap-4 cursor-pointer hover:bg-slate-50/50 transition-colors"
                >
                  <div className={cn(
                    "size-12 rounded-2xl flex items-center justify-center shrink-0 shadow-inner",
                    group.hasUrgent ? "bg-rose-100 text-rose-500" : (group.hasActive ? "bg-orange-100 text-orange-500" : "bg-slate-100 text-slate-400")
                  )}>
                    <User size={24} strokeWidth={2.5} />
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                       <span className="font-black text-base text-slate-900 truncate">{group.name}</span>
                       <Badge variant="secondary" className="bg-slate-100 text-slate-500 font-bold text-[10px] h-4.5 px-1.5 border-none shrink-0">
                        {group.orders.length} 单回顾
                       </Badge>
                       {group.hasUrgent && (
                         <Badge className="bg-rose-500 text-white text-[9px] font-black h-4 px-1.5 animate-pulse shrink-0">售后处理中</Badge>
                       )}
                    </div>
                    <div className="flex items-center gap-3 text-[11px] font-bold text-slate-400 mt-0.5">
                      <span className="tracking-tight">{group.phone}</span>
                      <div className="size-1 bg-slate-200 rounded-full" />
                      <span className="flex items-center gap-1"><Clock size={10} /> 最近: {new Date(group.latest.created_at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                  </div>

                  <div className="text-slate-300">
                    {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                  </div>
                </div>

                {/* 进行中的订单/最新订单快速入口 */}
                {!isExpanded && (
                  <div className="px-4 pb-4">
                    <div 
                      onClick={() => openOrder(group.latest)}
                      className={cn(
                        "p-4 rounded-3xl border flex items-center justify-between group active:scale-[0.98] transition-all",
                        group.latest.after_sales_status === 'pending' ? "bg-rose-50 border-rose-200 shadow-sm" : "bg-slate-50/50 border-slate-100"
                      )}
                    >
                      <div className="space-y-2.5">
                        <div className="flex items-center gap-2">
                          <Badge className={cn("text-[9px] font-black uppercase h-4.5 px-2", STATUS_COLORS[group.latest.status])}>
                            {STATUS_LABELS[group.latest.status]}
                          </Badge>
                          <span className="text-[13px] font-black text-slate-700 tracking-tight">尾号 {lastFourDigits(group.latest.phone)} · {formatPrice(Number(group.latest.total_amount))}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-[11px] text-slate-500 font-bold">
                          <MapPin size={12} className="text-slate-300 shrink-0" />
                          <span className="line-clamp-1">{group.latest.address}</span>
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" className="rounded-xl font-black text-orange-600 hover:bg-orange-100/50">
                        详情
                      </Button>
                    </div>
                  </div>
                )}

                {/* 展开的历史订单列表 */}
                {isExpanded && (
                  <div className="px-4 pb-5 border-t border-slate-100 pt-3 space-y-2.5 animate-in slide-in-from-top-1 duration-200">
                    <div className="flex items-center gap-2 mb-2 px-1">
                      <History size={12} className="text-slate-300" />
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">全量订单历史记录</span>
                    </div>
                    {group.orders.map(order => (
                      <div 
                        key={order.id}
                        onClick={() => openOrder(order)}
                        className="flex items-center justify-between p-3.5 bg-slate-50/80 rounded-2xl hover:bg-slate-100 transition-colors cursor-pointer group"
                      >
                        <div className="flex items-center gap-3">
                          <div className={cn("size-2 rounded-full", STATUS_COLORS[order.status].split(' ')[0])} />
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-[13px] font-black text-slate-700">尾号 {lastFourDigits(order.phone)} 订单</span>
                              <span className="text-[11px] font-bold text-slate-400">{new Date(order.created_at).toLocaleDateString()}</span>
                            </div>
                            <p className="text-[10px] font-bold text-slate-400 mt-0.5">{STATUS_LABELS[order.status]} · {formatPrice(Number(order.total_amount))}</p>
                          </div>
                        </div>
                        <ChevronRight size={14} className="text-slate-300 group-hover:text-slate-600 transition-colors" />
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}

        {sortedGroups.length === 0 && (
          <div className="flex flex-col items-center justify-center text-center py-24 bg-white rounded-[2.5rem] border-2 border-dashed border-slate-100 shadow-sm">
            <div className="size-24 bg-slate-50 rounded-full flex items-center justify-center mb-6 ring-8 ring-slate-50/50">
              <ShoppingBag size={48} className="text-slate-200" />
            </div>
            <h3 className="font-black text-slate-900 text-lg">暂无匹配订单</h3>
            <p className="text-[11px] text-slate-400 font-bold uppercase tracking-widest mt-1">请尝试搜索其他关键字</p>
          </div>
        )}
      </main>

      {selectedOrder && (
        <OrderManagerModal 
          order={selectedOrder} 
          onClose={() => setSelectedOrder(null)} 
          onSuccess={() => {
            setSelectedOrder(null)
            loadOrders()
          }}
        />
      )}
    </div>
  )
}

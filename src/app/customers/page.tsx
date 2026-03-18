'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { Merchant, Customer, Order } from '@/lib/types'
import { ArrowLeft, Search, Trophy, Phone, ShoppingBag, User, Crown, ChevronDown, ChevronUp, History, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { cn, formatPrice, lastFourDigits } from '@/lib/utils'
import OrderManagerModal from '@/components/OrderManagerModal'


export default function CustomersPage() {
  const supabase = createClient()
  const router = useRouter()
  const [merchant, setMerchant] = useState<Merchant | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [customerOrders, setCustomerOrders] = useState<Record<string, Order[]>>({})
  const [fetchingOrders, setFetchingOrders] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)

  const loadData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    const { data: m } = await supabase.from('merchants').select('*').eq('user_id', user.id).single()
    if (!m) return
    setMerchant(m)
    const { data: c } = await supabase.from('customers').select('*').eq('merchant_id', m.id).order('points', { ascending: false })
    setCustomers(c || [])
    setLoading(false)
  }, [supabase, router])

  useEffect(() => { loadData() }, [loadData])

  const toggleExpand = async (customerId: string) => {
    if (expandedId === customerId) {
      setExpandedId(null)
      return
    }
    setExpandedId(customerId)
    
    if (!customerOrders[customerId]) {
      setFetchingOrders(true)
      const { data } = await supabase
        .from('orders')
        .select('*')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
      
      if (data) {
        setCustomerOrders(prev => ({ ...prev, [customerId]: data }))
      }
      setFetchingOrders(false)
    }
  }

  const filtered = customers.filter(c =>
    c.name.includes(search) || c.phone.includes(search)
  )

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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="spinner" />
      </div>
    )
  }

  const rankBgClasses = ['bg-amber-400', 'bg-slate-300', 'bg-orange-300']
  const rankTextClasses = ['text-amber-500', 'text-slate-600', 'text-orange-800']

  return (
    <div className="min-h-screen bg-slate-50/50 font-sans pb-20 text-slate-900">
      <header className="fixed top-0 left-0 right-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-100 flex items-center gap-4 px-5 py-3 shadow-sm shadow-black/5">
        <Link href="/dashboard" className="p-2 -ml-2 hover:bg-slate-100 rounded-full transition-colors">
          <ArrowLeft size={20} className="text-slate-600" />
        </Link>
        <div className="flex flex-col">
          <h1 className="text-base font-black tracking-tight leading-none">客户资产管理</h1>
          <div className="flex items-center gap-1.5 mt-0.5">
            <Badge variant="secondary" className="bg-slate-100 text-slate-500 font-black text-[9px] h-3.5 px-1.5 border-none">
              {customers.length} 位已登记成员
            </Badge>
          </div>
        </div>
      </header>

      <main className="pt-20 px-5 max-w-2xl mx-auto space-y-4">
        <div className="sticky top-16 z-30 py-2 bg-slate-50/50 backdrop-blur-sm -mx-5 px-5">
          <div className="relative group">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 group-focus-within:text-orange-500 transition-colors" />
            <Input 
              placeholder="搜索客户姓名、手机号..." 
              value={search} 
              onChange={e => setSearch(e.target.value)}
              className="h-12 pl-10 pr-4 rounded-2xl bg-white border-slate-100 shadow-sm focus-visible:ring-orange-500 transition-all font-bold placeholder:font-medium"
            />
          </div>
        </div>

        <div className="space-y-3">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center text-center py-20 bg-white rounded-3xl border-2 border-dashed border-slate-100 shadow-sm">
              <div className="size-20 bg-slate-50 rounded-full flex items-center justify-center mb-5 ring-8 ring-slate-50/50">
                <User size={40} className="text-slate-200" />
              </div>
              <h3 className="font-black text-slate-900">未找到匹配客户</h3>
              <p className="text-xs text-slate-400 font-medium mt-1 uppercase">尝试输入姓名或手机号</p>
            </div>
          ) : (
            filtered.map((customer, idx) => {
              const isExpanded = expandedId === customer.id
              const orders = customerOrders[customer.id] || []
              
              return (
                <Card 
                  key={customer.id} 
                  className={cn(
                    "overflow-hidden border-none shadow-sm ring-1 ring-black/5 transition-all group",
                    isExpanded && "ring-orange-200 shadow-md"
                  )}
                >
                  <CardContent className="p-0">
                    <div 
                      onClick={() => toggleExpand(customer.id)}
                      className="p-4 flex items-center gap-4 cursor-pointer hover:bg-slate-50/50 transition-colors"
                    >
                      <div className={cn(
                        "size-12 rounded-2xl flex items-center justify-center shrink-0 shadow-inner relative transition-transform group-hover:scale-105",
                        idx < 3 ? rankBgClasses[idx] : "bg-slate-50"
                      )}>
                        {idx === 0 ? (
                          <Crown size={20} className="text-white fill-current" />
                        ) : (idx < 3) ? (
                          <Trophy size={18} className="text-white" />
                        ) : (
                          <span className="text-[13px] font-black text-slate-400 leading-none">{idx + 1}</span>
                        )}
                        
                        {idx < 3 && (
                          <div className="absolute -bottom-1 -right-1 bg-white size-5 rounded-full flex items-center justify-center shadow-sm">
                            <span className={cn("text-[9px] font-black", rankTextClasses[idx])}>{idx + 1}</span>
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-black text-[15px] text-slate-900 tracking-tight truncate">{customer.name}</span>
                          {customer.order_count > 10 && (
                            <Badge className="bg-emerald-50 text-emerald-600 text-[8px] font-black h-4 px-1 border-none">忠实会员</Badge>
                          )}
                        </div>
                        <div className="flex flex-col gap-0.5 mt-0.5">
                          <div className="flex items-center gap-3 text-[11px] font-bold text-slate-400 uppercase tracking-tighter">
                            <span className="flex items-center gap-1"><Phone size={10} className="shrink-0" /> {customer.phone}</span>
                          </div>
                        </div>
                      </div>

                      <div className="text-right flex items-center gap-3 shrink-0">
                        <div className="flex flex-col items-end">
                          <span className="text-lg font-black text-orange-500 tracking-tighter leading-none">{customer.points}</span>
                          <span className="text-[9px] text-slate-400 font-medium">当前可用积分</span>
                        </div>
                        <div className="text-slate-300">
                          {isExpanded ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                        </div>
                      </div>
                    </div>

                    {!isExpanded && (
                      <div className="px-4 flex justify-end">
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-bold bg-slate-50 px-3 py-1 rounded-full">
                           <span className="flex items-center gap-0.5 tracking-tighter"><ShoppingBag size={10} /> {customer.order_count}次交易</span>
                           <div className="size-0.5 bg-slate-200 rounded-full" />
                           <span className="tracking-tighter">消费总额: {formatPrice(Number(customer.total_spent))}</span>
                        </div>
                      </div>
                    )}

                    {isExpanded && (
                      <div className="px-4 pb-5 border-t border-slate-100 pt-4 space-y-3 animate-in fade-in slide-in-from-top-1 duration-300">
                        <div className="flex items-center justify-between px-1">
                           <div className="flex items-center gap-2">
                             <History size={14} className="text-orange-500" />
                             <span className="text-[11px] font-black text-slate-500 uppercase tracking-widest">消费订单全记录</span>
                           </div>
                           <div className="text-[10px] font-bold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">累计消费 {formatPrice(Number(customer.total_spent))}</div>
                        </div>

                        {fetchingOrders && orders.length === 0 ? (
                           <div className="py-8 flex justify-center"><div className="spinner border-orange-200" /></div>
                        ) : orders.length === 0 ? (
                           <div className="py-8 text-center text-xs text-slate-400 font-medium italic">暂无订单记录</div>
                        ) : (
                          <div className="space-y-2">
                            {orders.map(order => (
                              <div 
                                key={order.id}
                                onClick={() => setSelectedOrder(order)}
                                className="flex items-center justify-between p-3.5 bg-slate-50/80 rounded-2xl hover:bg-orange-50 hover:ring-1 hover:ring-orange-100 transition-all cursor-pointer group/item"
                              >
                                <div className="flex items-center gap-3">
                                  <div className={cn("size-2 rounded-full", STATUS_COLORS[order.status].split(' ')[0])} />
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-[13px] font-black text-slate-700">尾号 {lastFourDigits(order.phone)} 订单</span>
                                      <span className="text-[11px] font-bold text-slate-400">{new Date(order.created_at).toLocaleDateString()}</span>
                                    </div>
                                    <p className="text-[10px] font-bold text-slate-400 mt-0.5">
                                      {STATUS_LABELS[order.status]} · {formatPrice(Number(order.total_amount))}
                                    </p>
                                  </div>
                                </div>
                                <ChevronRight size={14} className="text-slate-300 group-hover/item:text-orange-400 transition-colors" />
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })
          )}
        </div>
      </main>

      {selectedOrder && (
        <OrderManagerModal 
          order={selectedOrder} 
          onClose={() => setSelectedOrder(null)} 
          onSuccess={() => {
            if (expandedId) {
             supabase
              .from('orders')
              .select('*')
              .eq('customer_id', expandedId)
              .order('created_at', { ascending: false })
              .then(({ data }) => {
                 if (data) setCustomerOrders(prev => ({ ...prev, [expandedId]: data }))
              })
            }
            setSelectedOrder(null)
          }}
        />
      )}
    </div>
  )
}

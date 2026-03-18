'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { Merchant, Order } from '@/lib/types'
import { formatPrice, speak, lastFourDigits, cn } from '@/lib/utils'
import {
  Menu, X, LogOut, UtensilsCrossed, ClipboardList, Users,
  ChefHat, TrendingUp, Clock, Copy, Check, Settings, MessageSquare, Tag,
  Star
} from 'lucide-react'
import Link from 'next/link'
import OrderManagerModal from '@/components/OrderManagerModal'
import OrderCard from '@/components/OrderCard'
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"


export default function DashboardPage() {
  const supabase = createClient()
  const router = useRouter()
  const [merchant, setMerchant] = useState<Merchant | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [todayOrders, setTodayOrders] = useState<Order[]>([])
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(true)
  const [unreadMsgCount, setUnreadMsgCount] = useState(0)
  const [pendingAfterSalesCount, setPendingAfterSalesCount] = useState(0)

  // 订单详情状态 (复用外部组件)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  
  // 订单标记状态
  const [unreadOrderIds, setUnreadOrderIds] = useState<Set<string>>(new Set())
  const [negotiatingOrderIds, setNegotiatingOrderIds] = useState<Set<string>>(new Set())

  const loadData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: merchantData } = await supabase
      .from('merchants')
      .select('*')
      .eq('user_id', user.id)
      .single()

    if (!merchantData) { router.push('/login'); return }
    setMerchant(merchantData)

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const { data: orders } = await supabase
      .from('orders')
      .select('*')
      .eq('merchant_id', merchantData.id)
      .gte('created_at', today.toISOString())
      .order('created_at', { ascending: false })

    setTodayOrders(orders || [])

    // 未读消息数与详情
    const { data: unreadMsgs } = await supabase
      .from('messages')
      .select('order_id, content, msg_type')
      .eq('merchant_id', merchantData.id)
      .eq('sender', 'customer')
      .eq('is_read_by_merchant', false)
    
    setUnreadMsgCount(unreadMsgs?.length || 0)
    setUnreadOrderIds(new Set(unreadMsgs?.map(m => m.order_id) || []))
    setNegotiatingOrderIds(new Set(
      unreadMsgs?.filter(m => m.msg_type === 'after_sales' || m.content.startsWith('【协商退单】') || m.content === '客户想和你协商退单')
        .map(m => m.order_id) || []
    ))

    // 待售后订单数量 (全历史)
    const { count: afterSalesCount } = await supabase
      .from('orders')
      .select('id', { count: 'exact', head: true })
      .eq('merchant_id', merchantData.id)
      .eq('after_sales_status', 'pending')

    setPendingAfterSalesCount(afterSalesCount || 0)

    setLoading(false)
  }, [supabase, router])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadData()
  }, [loadData])

  // 实时订阅新订单
  useEffect(() => {
    if (!merchant) return
    const channel = supabase
      .channel('new-orders')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'orders', filter: `merchant_id=eq.${merchant.id}` },
        (payload) => {
          const newOrder = payload.new as Order
          setTodayOrders(prev => [newOrder, ...prev])
          speak(`叮！接到来自${lastFourDigits(newOrder.phone)}的订单啦！`)
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'orders', filter: `merchant_id=eq.${merchant.id}` },
        (payload) => {
          const updated = payload.new as Order
          const old = payload.old as Partial<Order>
          
          setTodayOrders(prev => prev.map(o => o.id === updated.id ? updated : o))
          // 实时同步当前打开的详情弹窗
          setSelectedOrder(prev => prev?.id === updated.id ? updated : prev)
          
          if (updated.status === 'cancelled' && updated.cancelled_by === 'customer') {
            setTimeout(() => speak(`${lastFourDigits(updated.phone)}取消订单啦！`), 100)
          }
          if (updated.after_sales_status === 'pending' && old.after_sales_status !== 'pending') {
            setPendingAfterSalesCount(c => c + 1)
            setTimeout(() => speak(`尾号 ${lastFourDigits(updated.phone)} 的客户申请了售后 理由是 ${updated.after_sales_reason || '未知'} 请尽快处理！`), 200)
          }
          if (updated.after_sales_status !== 'pending' && old.after_sales_status === 'pending') {
            setPendingAfterSalesCount(c => Math.max(0, c - 1))
          }
          if (updated.after_sales_status === 'pending' && old.after_sales_status === 'pending') {
            const oldUrge = old.after_sales_urge_count || 0
            const newUrge = updated.after_sales_urge_count || 0
            if (newUrge > oldUrge) {
              setTimeout(() => speak(`尾号 ${lastFourDigits(updated.phone)} 的客户 第 ${newUrge} 次催促您处理售后，请尽快处理！`), 200)
            }
          }
        }
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `merchant_id=eq.${merchant.id}` },
        () => loadData() // 消息已读状态变更时刷新标记
      )
      .subscribe()

    // 实时订阅新消息
    const msgChannel = supabase
      .channel('dashboard-messages')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `merchant_id=eq.${merchant.id}` },
        (payload) => {
          const newMsg = payload.new as Record<string, unknown>
          if (newMsg.sender === 'customer') {
            setUnreadMsgCount(c => c + 1)
            setUnreadOrderIds(prev => new Set([...Array.from(prev), newMsg.order_id as string]))
            if (newMsg.msg_type === 'after_sales' || (typeof newMsg.content === 'string' && newMsg.content.includes('协商退单'))) {
              setNegotiatingOrderIds(prev => new Set([...Array.from(prev), newMsg.order_id as string]))
            }
            speak('口讯口讯，有新留言啊！')
          }
        }
      ).subscribe()

    return () => {
      supabase.removeChannel(channel)
      supabase.removeChannel(msgChannel)
    }
  }, [merchant, supabase])

  // Fallback copy function for non-secure contexts
  const copyToClipboard = (text: string) => {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text)
    } else {
      // Fallback for non-secure contexts or older browsers
      const textArea = document.createElement('textarea')
      textArea.value = text
      textArea.style.position = 'fixed' // Avoid scrolling to bottom
      textArea.style.left = '-999999px' // Move outside the screen to hide it
      document.body.appendChild(textArea)
      textArea.focus()
      textArea.select()
      try {
        document.execCommand('copy')
      } catch (err) {
        console.error('Fallback: Oops, unable to copy', err)
      }
      document.body.removeChild(textArea)
    }
  }

  function copyShareLink() {
    if (!merchant) return
    const link = `${window.location.origin}/m/${merchant.id}`
    const text = `${link}`
    copyToClipboard(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

  // ============== 订单处理组件化完毕 ==============

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="spinner" />
      </div>
    )
  }

  const completedOrders = todayOrders.filter(o => o.status === 'completed')
  const todayRevenue = completedOrders.reduce((sum, o) => sum + Number(o.total_amount), 0)
  const pendingCount = todayOrders.filter(o => o.status === 'pending' || o.after_sales_status === 'pending').length

  const NAV_ITEMS = [
    { href: '/menu', icon: <UtensilsCrossed size={22} className="text-orange-500" />, bg: 'bg-orange-50', label: '菜单管理', desc: '管理菜品和分类' },
    { 
      href: '/orders', 
      icon: <ClipboardList size={22} className="text-blue-500" />, 
      bg: 'bg-blue-50', 
      label: '订单管理', 
      desc: '查看和处理订单',
      badge: pendingAfterSalesCount > 0 ? `待售后 (${pendingAfterSalesCount})` : null
    },
    { href: '/customers', icon: <Users size={22} className="text-emerald-500" />, bg: 'bg-emerald-50', label: '客户管理', desc: '客户信息和积分' },
    { href: '/settings', icon: <Settings size={22} className="text-purple-500" />, bg: 'bg-purple-50', label: '店铺设置', desc: '接单控制、收款码' },
    { href: '/coupons', icon: <Tag size={22} className="text-amber-500" />, bg: 'bg-amber-50', label: '优惠券', desc: '创建和管理优惠券' },
    { 
      href: '/messages', 
      icon: <MessageSquare size={22} className="text-rose-500" />, 
      bg: 'bg-rose-50', 
      label: '客户消息', 
      desc: '评论与留言',
      count: unreadMsgCount
    },
  ]

  return (
    <div className="min-h-screen bg-slate-50/50 font-sans pb-20">
      {/* 顶部栏 */}
      <header className="fixed top-0 left-0 right-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-100 px-5 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button 
            variant="ghost" 
            size="icon" 
            className="rounded-full size-10 text-slate-700 bg-slate-100/50 hover:bg-slate-100 active:scale-95 transition-transform shrink-0"
            onClick={() => setSidebarOpen(true)}
          >
            <Menu size={20} />
          </Button>
          <div className="flex flex-col">
            <h1 className="text-[17px] font-black text-slate-900 leading-none flex items-center gap-1.5">
              {merchant?.shop_name}
              {merchant?.rating && (
                <div className="flex items-center gap-0.5 bg-amber-50 px-1.5 py-0.5 rounded-full border border-amber-100">
                  <Star fill="#f59e0b" className="text-amber-500" size={10} />
                  <span className="text-[10px] text-amber-600 font-black">{merchant.rating.toFixed(1)}</span>
                </div>
              )}
            </h1>
            <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-0.5">商家管理后台</span>
          </div>
        </div>
        
        <Button 
          variant={copied ? "default" : "outline"}
          size="sm"
          onClick={copyShareLink}
          className={cn(
            "rounded-full font-black text-xs transition-all duration-300",
            copied ? "bg-emerald-500 hover:bg-emerald-600 border-none px-4 shadow-lg shadow-emerald-200" : "bg-white shadow-sm"
          )}
        >
          {copied ? <Check size={14} className="mr-1" /> : <Copy size={14} className="mr-1" />}
          {copied ? '已复制' : '分享链接'}
        </Button>
      </header>

      {/* 主体内容 */}
      <main className="pt-20 max-w-2xl mx-auto px-4 space-y-8">
        {/* 数据概览 */}
        <section className="grid grid-cols-3 gap-3">
          <Card className="border-none shadow-sm ring-1 ring-slate-100 bg-white rounded-3xl overflow-hidden transition-all active:scale-[0.98]">
            <CardContent className="p-5 text-center flex flex-col items-center justify-center">
              <div className="size-8 bg-blue-50 text-blue-500 rounded-full flex items-center justify-center mb-2">
                <ClipboardList size={16} />
              </div>
              <p className="text-2xl font-black text-slate-900 leading-none">{todayOrders.length}</p>
              <p className="text-[11px] font-bold text-slate-400 mt-1.5">今日订单</p>
            </CardContent>
          </Card>
          <Card className="border-none shadow-sm ring-1 ring-slate-100 bg-white rounded-3xl overflow-hidden transition-all active:scale-[0.98]">
            <CardContent className="p-5 text-center flex flex-col items-center justify-center">
               <div className="size-8 bg-emerald-50 text-emerald-500 rounded-full flex items-center justify-center mb-2">
                <span className="font-black text-sm">¥</span>
              </div>
              <p className="text-xl font-black text-emerald-600 leading-none">{formatPrice(todayRevenue).replace('¥', '')}</p>
              <p className="text-[11px] font-bold text-slate-400 mt-1.5">今日营收</p>
            </CardContent>
          </Card>
          <Card className={cn(
            "border-none shadow-sm ring-1 rounded-3xl overflow-hidden transition-all active:scale-[0.98]",
            pendingCount > 0 ? "ring-orange-200 bg-orange-50/50" : "ring-slate-100 bg-white"
          )}>
            <CardContent className="p-5 text-center flex flex-col items-center justify-center">
              <div className={cn(
                "size-8 rounded-full flex items-center justify-center mb-2",
                pendingCount > 0 ? "bg-orange-100 text-orange-600" : "bg-slate-50 text-slate-400"
              )}>
                <Clock size={16} />
              </div>
              <p className={cn(
                "text-2xl font-black leading-none",
                pendingCount > 0 ? "text-orange-600 animate-pulse" : "text-slate-400"
              )}>{pendingCount}</p>
              <p className={cn(
                "text-[11px] font-bold mt-1.5",
                pendingCount > 0 ? "text-orange-500" : "text-slate-400"
              )}>待处理</p>
            </CardContent>
          </Card>
        </section>

        {/* 最新订单列表 */}
        <section className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-[17px] font-black text-slate-900 tracking-tight flex items-center gap-2">
              <Clock size={20} className="text-slate-400" />
              最近订单
              {todayOrders.length > 0 && (
                <Badge variant="secondary" className="bg-slate-100 text-slate-500 font-black h-5 px-2 rounded-full">
                  前 5 单
                </Badge>
              )}
            </h2>
          </div>
          
          <div className="space-y-3">
            {todayOrders.length === 0 ? (
              <div className="py-10 flex flex-col items-center justify-center text-center bg-white rounded-2xl border border-dashed border-slate-200 shadow-sm">
                <div className="size-16 bg-slate-50 rounded-full flex items-center justify-center mb-4">
                  <TrendingUp className="text-slate-200" size={32} />
                </div>
                <p className="text-slate-600 font-black">今天还没有订单</p>
                <p className="text-[11px] text-slate-400 font-medium mt-1">分享链接开始接单吧</p>
              </div>
            ) : (
              [...todayOrders].sort((a, b) => {
                if (a.after_sales_status === 'pending' && b.after_sales_status !== 'pending') return -1;
                if (a.after_sales_status !== 'pending' && b.after_sales_status === 'pending') return 1;
                return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
              }).slice(0, 5).map(order => (
                <OrderCard
                  key={order.id}
                  order={order}
                  isUrgent={order.after_sales_status === 'pending' || negotiatingOrderIds.has(order.id)}
                  isNegotiating={negotiatingOrderIds.has(order.id)}
                  isNewMessage={unreadOrderIds.has(order.id)}
                  onClick={() => setSelectedOrder(order)}
                />
              ))
            )}
          </div>
        </section>

        {/* 快捷导航 */}
        <section>
          <h2 className="text-[15px] font-black text-slate-900 tracking-tight mb-3 px-1">快捷功能</h2>
          <div className="grid grid-cols-3 gap-3">
            {NAV_ITEMS.map((item) => (
              <Link key={item.href} href={item.href} className="group no-underline relative">
                <div className="flex flex-col items-center gap-2 p-3 rounded-3xl bg-transparent transition-all duration-300 active:scale-95 active:bg-slate-100/50">
                  <div className={cn("size-[52px] rounded-[1.25rem] flex items-center justify-center shrink-0 shadow-sm", item.bg)}>
                    {item.icon}
                  </div>
                  <span className="text-[11px] font-black text-slate-700 tracking-tighter whitespace-nowrap text-center">
                    {item.label}
                  </span>

                  {/* 角标提醒 */}
                  {item.badge ? (
                    <span className="absolute top-2 right-3 translate-x-1/2 flex h-5 min-w-[20px] animate-pulse items-center justify-center rounded-full bg-orange-500 px-1.5 text-[10px] font-black text-white ring-4 ring-white shadow-sm">
                      !
                    </span>
                  ) : (item.count !== undefined && item.count > 0) ? (
                    <span className="absolute top-2 right-3 translate-x-1/2 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-rose-500 px-1.5 text-[10px] font-black text-white ring-4 ring-white shadow-sm">
                      {item.count}
                    </span>
                  ) : null}
                </div>
              </Link>
            ))}
          </div>
        </section>
      </main>

      {/* 侧边栏菜单 (手写适配) */}
      {sidebarOpen && (
        <>
          <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-50 transition-opacity" onClick={() => setSidebarOpen(false)} />
          <div className="fixed top-0 left-0 h-full w-[280px] bg-white shadow-2xl z-50 p-6 flex flex-col font-sans animate-in slide-in-from-left duration-300">
            <div className="flex items-center justify-between mb-8">
              <div className="flex items-center gap-2">
                <div className="size-8 bg-orange-500 rounded-lg flex items-center justify-center shrink-0">
                  <ChefHat size={18} className="text-white" />
                </div>
                <span className="font-black text-slate-900 truncate max-w-[160px]">{merchant?.shop_name}</span>
              </div>
              <Button variant="ghost" size="icon-sm" onClick={() => setSidebarOpen(false)} className="rounded-full active:bg-slate-100 shrink-0">
                <X size={20} className="text-slate-500" />
              </Button>
            </div>

            <ScrollArea className="flex-1 -mx-4 px-4 overflow-y-auto">
              <nav className="space-y-1">
                {[
                  { href: '/dashboard', icon: <TrendingUp size={18} />, label: '仪表盘' },
                  { href: '/menu', icon: <UtensilsCrossed size={18} />, label: '菜单管理' },
                  { href: '/orders', icon: <ClipboardList size={18} />, label: '订单管理' },
                  { href: '/customers', icon: <Users size={18} />, label: '客户管理' },
                  { href: '/coupons', icon: <Tag size={18} />, label: '优惠券' },
                  { href: '/settings', icon: <Settings size={18} />, label: '店铺设置' },
                ].map(item => (
                  <Link key={item.href} href={item.href} className="no-underline">
                    <div className="flex items-center gap-3 px-4 py-3.5 rounded-xl active:bg-slate-50 transition-colors group">
                      <div className="text-slate-400 group-active:text-orange-500 transition-colors">{item.icon}</div>
                      <span className="font-bold text-slate-700 group-active:text-slate-900">{item.label}</span>
                    </div>
                  </Link>
                ))}
              </nav>
            </ScrollArea>

            <Separator className="my-6 opacity-50" />
            
            <Button 
              variant="outline" 
              className="mt-auto w-full flex items-center justify-center gap-2 border-slate-100 text-rose-500 active:bg-rose-50 active:border-rose-100 font-black h-12 transition-all rounded-xl"
              onClick={handleLogout}
            >
              <LogOut size={16} />
              退出登录
            </Button>
          </div>
        </>
      )}

      {/* 详情弹窗 */}
      {selectedOrder && (
        <OrderManagerModal 
          order={selectedOrder} 
          onClose={() => setSelectedOrder(null)} 
          onSuccess={() => {
            setSelectedOrder(null)
            loadData()
          }}
        />
      )}
    </div>
  )
}

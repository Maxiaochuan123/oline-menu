'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { Merchant, Order } from '@/lib/types'
import { formatPrice, speak, lastFourDigits, cn } from '@/lib/utils'
import {
  Menu, X, LogOut, UtensilsCrossed, ClipboardList, Users,
   ChefHat, TrendingUp, Clock, Settings, MessageSquare, Tag,
   Star, Crown
} from 'lucide-react'
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import Link from 'next/link'
import OrderManagerModal from '@/components/OrderManagerModal'
import OrderCard from '@/components/OrderCard'
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import CopyButton from '@/components/common/CopyButton'

export default function DashboardPage() {
  const supabase = createClient()
  const router = useRouter()
  const [merchant, setMerchant] = useState<Merchant | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [todayOrders, setTodayOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [unreadMsgCount, setUnreadMsgCount] = useState(0)
  const [pendingAfterSalesCount, setPendingAfterSalesCount] = useState(0)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)

  // 订单详情状态 (复用外部组件)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  
  // 订单标记状态
  const [unreadOrderIds, setUnreadOrderIds] = useState<Set<string>>(new Set())
  const [unreadCounts, setUnreadCounts] = useState<Record<string, number>>({})
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
    
    // 计算每个订单的未读数
    const counts: Record<string, number> = {}
    unreadMsgs?.forEach(m => {
      counts[m.order_id] = (counts[m.order_id] || 0) + 1
    })
    setUnreadCounts(counts)

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
            const orderId = newMsg.order_id as string
            setUnreadOrderIds(prev => new Set([...Array.from(prev), orderId]))
            setUnreadCounts(prev => ({
              ...prev,
              [orderId]: (prev[orderId] || 0) + 1
            }))
            if (newMsg.msg_type === 'after_sales' || (typeof newMsg.content === 'string' && newMsg.content.includes('协商退单'))) {
              setNegotiatingOrderIds(prev => new Set([...Array.from(prev), orderId]))
            }
            speak('口讯口讯，有新留言啊！')
          }
        }
      ).subscribe()

    return () => {
      supabase.removeChannel(channel)
      supabase.removeChannel(msgChannel)
    }
  }, [merchant, supabase, loadData])

  async function handleLogout() {
    await supabase.auth.signOut()
    router.push('/login')
  }

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
    { 
      href: '/orders', 
      icon: <ClipboardList size={22} className="text-indigo-500" />, 
      bg: 'bg-indigo-50', 
      label: '订单管理', 
      desc: '查看和处理订单',
      badge: pendingAfterSalesCount > 0 ? `待售后 (${pendingAfterSalesCount})` : null
    },
    { href: '/menu', icon: <UtensilsCrossed size={22} className="text-orange-500" />, bg: 'bg-orange-50', label: '菜单管理', desc: '管理菜品和分类' },
    { 
      href: '/messages', 
      icon: <MessageSquare size={22} className="text-blue-500" />, 
      bg: 'bg-blue-50', 
      label: '客户消息', 
      desc: '评论与留言互动',
      count: unreadMsgCount
    },
    { href: '/customers', icon: <Users size={22} className="text-emerald-500" />, bg: 'bg-emerald-50', label: '客户管理', desc: '客户画像与积分' },
    { href: '/membership', icon: <Crown size={22} className="text-amber-500" />, bg: 'bg-amber-50', label: '会员等级', desc: '特权、积分与折扣' },
    { href: '/coupons', icon: <Tag size={22} className="text-sky-500" />, bg: 'bg-sky-50', label: '优惠券', desc: '营销拉新促活工具' },
    { href: '/settings', icon: <Settings size={22} className="text-slate-500" />, bg: 'bg-slate-50', label: '店铺设置', desc: '基础信息与接单控制' },
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
        
        <CopyButton 
          text={`${typeof window !== 'undefined' ? window.location.origin : ''}/m/${merchant?.id}`}
          initialLabel="分享链接"
          className="active:scale-95 shadow-sm"
        />
      </header>

      {/* 主体内容 */}
      <main className="pt-20 max-w-2xl mx-auto px-4 space-y-6">
        {/* 数据概览 */}
        <section className="grid grid-cols-3 gap-3">
          <Card className="border-none shadow-[0_2px_8px_rgba(0,0,0,0.02)] ring-1 ring-slate-100 bg-white rounded-[1.25rem] transition-all active:scale-[0.98]">
            <CardContent className="p-3.5 flex flex-col items-center justify-center">
              <div className="size-7 bg-blue-50/80 text-blue-500 rounded-lg flex items-center justify-center mb-1.5 text-blue-600">
                <ClipboardList size={14} />
              </div>
              <p data-testid="dashboard-today-orders-count" className="text-[20px] font-black text-slate-900 leading-none tracking-tight">{todayOrders.length}</p>
              <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-tight">今日订单</p>
            </CardContent>
          </Card>
          <Card className="border-none shadow-[0_2px_8px_rgba(0,0,0,0.02)] ring-1 ring-slate-100 bg-white rounded-[1.25rem] transition-all active:scale-[0.98]">
            <CardContent className="p-3.5 flex flex-col items-center justify-center">
               <div className="size-7 bg-emerald-50/80 text-emerald-500 rounded-lg flex items-center justify-center mb-1.5">
                <span className="font-black text-xs">¥</span>
              </div>
              <p data-testid="dashboard-today-revenue" className="text-[18px] font-black text-emerald-600 leading-none tracking-tight">{formatPrice(todayRevenue).replace('¥', '')}</p>
              <p className="text-[10px] font-bold text-slate-400 mt-1 uppercase tracking-tight">今日营收</p>
            </CardContent>
          </Card>
          <Card className={cn(
            "border-none shadow-[0_2px_8px_rgba(0,0,0,0.02)] ring-1 rounded-[1.25rem] transition-all active:scale-[0.98]",
            pendingCount > 0 ? "ring-orange-200 bg-orange-50/50" : "ring-slate-100 bg-white"
          )}>
            <CardContent className="p-3.5 flex flex-col items-center justify-center">
              <div className={cn(
                "size-7 rounded-lg flex items-center justify-center mb-1.5",
                pendingCount > 0 ? "bg-orange-100 text-orange-600 shadow-sm" : "bg-slate-50 text-slate-400"
              )}>
                <Clock size={14} />
              </div>
              <p className={cn(
                "text-[20px] font-black leading-none tracking-tight",
                pendingCount > 0 ? "text-orange-600 animate-pulse" : "text-slate-400"
              )} data-testid="dashboard-pending-count">{pendingCount}</p>
              <p className={cn(
                "text-[10px] font-bold mt-1 uppercase tracking-tight",
                pendingCount > 0 ? "text-orange-500" : "text-slate-400"
              )}>待处理</p>
            </CardContent>
          </Card>
        </section>
        
        {/* 快捷导航 (优化版: Squircle 风格) */}
        <section className="-mx-4 overflow-hidden py-2">
          <div className="px-6 mb-4">
            <h2 className="text-[11px] font-black text-slate-400 uppercase tracking-[0.15em] leading-none">
              管理快捷入口
            </h2>
          </div>
          <div className="flex gap-5 overflow-x-auto px-6 pt-5 pb-6 snap-x no-scrollbar select-none">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                data-testid={item.href === '/messages' ? 'dashboard-messages-link' : undefined}
                className="group no-underline relative flex-shrink-0 snap-center"
              >
                <div className="flex flex-col items-center gap-3 transition-all duration-300 active:scale-95">
                  <div className="size-[64px] rounded-[1.5rem] bg-white flex items-center justify-center shrink-0 shadow-[0_4px_12px_rgba(0,0,0,0.03)] border border-slate-100 transition-all group-hover:shadow-lg group-hover:shadow-slate-200/50 group-hover:-translate-y-1">
                    <div className={cn("size-11 rounded-[1rem] flex items-center justify-center shrink-0 shadow-sm transition-transform", item.bg)}>
                      {item.icon}
                    </div>
                  </div>
                  <span className="text-[12px] font-bold text-slate-600 tracking-tight whitespace-nowrap">
                    {item.label}
                  </span>

                  {/* 角标提醒 */}
                  {item.badge ? (
                    <span className="absolute top-0 right-0 translate-x-1.2 -translate-y-1.2 z-10 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-orange-500 px-1.5 text-[10px] font-black text-white ring-4 ring-white shadow-lg shadow-orange-100 tag-pulse-red">
                      !
                    </span>
                  ) : (item.count !== undefined && item.count > 0) ? (
                    <span
                      data-testid={item.href === '/messages' ? 'dashboard-messages-count' : undefined}
                      className="absolute top-0 right-0 translate-x-1.2 -translate-y-1.2 z-10 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-blue-600 px-1.5 text-[10px] font-black text-white ring-4 ring-white shadow-lg shadow-blue-100 tag-pulse-blue"
                    >
                      {item.count}
                    </span>
                  ) : null}
                </div>
              </Link>
            ))}
          </div>
        </section>

        {/* 最新订单列表 */}
        <section className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-[17px] font-black text-slate-900 tracking-tight flex items-center gap-2">
              <Clock size={20} className="text-slate-400" />
              最近订单
              {todayOrders.length > 0 && (
                <Badge variant="secondary" className="bg-slate-100 text-slate-500 font-black h-5 px-2 rounded-full">
                  前 10 单
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
              }).slice(0, 10).map(order => (
                <OrderCard
                  key={order.id}
                  order={order}
                  isUrgent={order.after_sales_status === 'pending' || negotiatingOrderIds.has(order.id)}
                  isNegotiating={negotiatingOrderIds.has(order.id)}
                  isNewMessage={unreadOrderIds.has(order.id)}
                  newMessageCount={unreadCounts[order.id] || 0}
                  onClick={() => setSelectedOrder(order)}
                />
              ))
            )}
          </div>
        </section>

      </main>

      {/* 侧边栏菜单 (定制化 Sheet 组件库 - 紧凑版) */}
      <Sheet open={sidebarOpen} onOpenChange={setSidebarOpen}>
        <SheetContent side="left" className="w-[256px] border-none p-0 flex flex-col font-sans bg-white shadow-2xl [&>button]:hidden">
          {/* 定制 Header */}
          <div className="flex items-center justify-between px-6 py-8 pb-4">
            <div className="flex items-center gap-2.5">
              <div className="size-9 bg-orange-500 rounded-xl flex items-center justify-center shrink-0 shadow-lg shadow-orange-100/50">
                <ChefHat size={18} className="text-white" />
              </div>
              <SheetTitle className="font-black text-[16px] text-slate-800 truncate max-w-[130px]">
                {merchant?.shop_name}
              </SheetTitle>
            </div>
            <Button 
              variant="ghost" 
              size="icon-sm" 
              onClick={() => setSidebarOpen(false)} 
              className="rounded-full bg-slate-50 hover:bg-slate-100 active:scale-90 transition-all shrink-0 size-8"
            >
              <X size={16} className="text-slate-500" />
            </Button>
          </div>

          {/* 导航区域 */}
          <ScrollArea className="flex-1 px-4 mt-2">
            <nav className="space-y-1 pb-20">
              {[
                { href: '/orders', icon: <ClipboardList size={20} className="text-indigo-500" />, bg: 'bg-indigo-50', label: '订单管理' },
                { href: '/menu', icon: <UtensilsCrossed size={20} className="text-orange-500" />, bg: 'bg-orange-50', label: '菜单管理' },
                { href: '/messages', icon: <MessageSquare size={20} className="text-blue-500" />, bg: 'bg-blue-50', label: '客户消息', count: unreadMsgCount },
                { type: 'separator' },
                { href: '/customers', icon: <Users size={20} className="text-emerald-500" />, bg: 'bg-emerald-50', label: '客户管理' },
                { href: '/membership', icon: <Crown size={20} className="text-amber-500" />, bg: 'bg-amber-50', label: '会员等级' },
                { href: '/coupons', icon: <Tag size={20} className="text-sky-500" />, bg: 'bg-sky-50', label: '优惠券' },
                { type: 'separator' },
                { href: '/settings', icon: <Settings size={20} className="text-slate-500" />, bg: 'bg-slate-50', label: '店铺设置' },
              ].map((item, idx) => (
                item.type === 'separator' ? (
                  <div key={`sep-${idx}`} className="py-1 px-3">
                    <div className="h-px bg-slate-100/60 w-full" />
                  </div>
                ) : (
                  <Link 
                    key={item.href} 
                    href={item.href || '#'} 
                    className="no-underline block group"
                    onClick={() => setSidebarOpen(false)}
                  >
                    <div className="flex items-center justify-between px-3 py-2.5 rounded-2xl group-active:bg-slate-100/70 transition-all duration-200">
                      <div className="flex items-center gap-3">
                        <div className={cn("size-9 rounded-xl flex items-center justify-center transition-transform group-hover:scale-105", item.bg)}>
                          {item.icon}
                        </div>
                        <span className="font-bold text-slate-600 group-active:text-slate-900 text-sm">{item.label}</span>
                      </div>
                      {item.count !== undefined && item.count > 0 && (
                        <div className="size-5 rounded-full bg-rose-500 flex items-center justify-center text-[10px] font-black text-white shadow-lg shadow-rose-100">
                          {item.count}
                        </div>
                      )}
                    </div>
                  </Link>
                )
              ))}
            </nav>
          </ScrollArea>

          {/* 底部退出按钮 (红色警示风格) */}
          <div className="p-4 pt-4 pb-8 bg-white border-t border-slate-50">
            <Button 
              variant="outline" 
              className="w-full h-12 flex items-center justify-center gap-2.5 border-none bg-rose-50/50 hover:bg-rose-500 hover:text-white text-rose-500 font-bold transition-all rounded-[1rem] active:scale-[0.97]"
              onClick={() => setShowLogoutConfirm(true)}
            >
              <div className="size-8 bg-white/80 rounded-lg shadow-sm flex items-center justify-center">
                <LogOut size={16} />
              </div>
              退出登录
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      {/* 退出登录二次确认 */}
      <AlertDialog open={showLogoutConfirm} onOpenChange={setShowLogoutConfirm}>
        <AlertDialogContent className="max-w-[340px] border-none rounded-[24px] p-0 overflow-hidden shadow-2xl bg-white">
          <div className="relative p-6 pt-10 flex flex-col items-center text-center">
            {/* 装饰性背景 */}
            <div className="absolute -right-6 -top-6 size-32 bg-rose-50/40 blur-2xl" />
            
            <div className="relative mb-6 flex size-16 items-center justify-center rounded-[20px] bg-rose-50 text-rose-600 shadow-inner ring-8 ring-rose-50/30">
              <LogOut size={32} />
            </div>
            
            <AlertDialogTitle className="text-xl font-black text-slate-900 tracking-tight">确认退出登录？</AlertDialogTitle>
            
            <div className="mt-4 px-1">
              <AlertDialogDescription className="text-[14px] font-medium leading-relaxed text-slate-500">
                退出后将无法为您实时播放<span className="font-bold text-rose-600 mx-0.5">新订单语音提醒</span>。
              </AlertDialogDescription>
            </div>
          </div>
          <div className="flex flex-col gap-2 p-6 pt-0">
            <AlertDialogAction
              className="h-12 rounded-[18px] bg-rose-600 font-black text-white shadow-lg shadow-rose-100 hover:bg-rose-700 transition-all active:scale-95 border-none"
              onClick={handleLogout}
            >
              确认退出
            </AlertDialogAction>
            <AlertDialogCancel className="h-12 border-none bg-slate-50 font-bold text-slate-500 hover:bg-slate-100 transition-all active:scale-95 rounded-[18px]">
              取消
            </AlertDialogCancel>
          </div>
        </AlertDialogContent>
      </AlertDialog>

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
      {/* 注入隐藏滚动条的样式 */}
      <style jsx global>{`
        .no-scrollbar::-webkit-scrollbar {
          display: none;
        }
        .no-scrollbar {
          -ms-overflow-style: none;
          scrollbar-width: none;
        }
      `}</style>
    </div>
  )
}

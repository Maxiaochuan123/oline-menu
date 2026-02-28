'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { Merchant, Order } from '@/lib/types'
import { formatPrice, speak, lastFourDigits } from '@/lib/utils'
import {
  Menu, X, LogOut, UtensilsCrossed, ClipboardList, Users,
  ChefHat, TrendingUp, Clock, Copy, Check, Settings, MessageSquare, Tag,
  AlertTriangle, CheckCircle, ChevronRight, Star
} from 'lucide-react'
import Link from 'next/link'
import OrderManagerModal from '../../components/OrderManagerModal'

const STATUS_LABELS: Record<string, string> = {
  pending: '待处理',
  preparing: '制作中',
  delivering: '配送中',
  completed: '已完成',
  cancelled: '已取消'
}
const STATUS_FLOW = ['pending', 'preparing', 'delivering', 'completed']

export default function DashboardPage() {
  const supabase = createClient()
  const router = useRouter()
  const [merchant, setMerchant] = useState<Merchant | null>(null)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [todayOrders, setTodayOrders] = useState<Order[]>([])
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(true)
  const [unreadMsgCount, setUnreadMsgCount] = useState(0)

  // 订单详情状态 (复用外部组件)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)

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

    // 未读消息数
    const { count } = await supabase
      .from('messages')
      .select('*', { count: 'exact', head: true })
      .eq('merchant_id', merchantData.id)
      .eq('sender', 'customer')
      .eq('is_read_by_merchant', false)
    setUnreadMsgCount(count || 0)

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
          if (updated.status === 'cancelled' && updated.cancelled_by === 'customer') {
            setTimeout(() => speak(`${lastFourDigits(updated.phone)}取消订单啦！`), 100)
          }
          if (updated.after_sales_status === 'pending' && old.after_sales_status !== 'pending') {
            setTimeout(() => speak(`尾号 ${lastFourDigits(updated.phone)} 的客户申请了售后 理由是 ${updated.after_sales_reason || '未知'} 请尽快处理！`), 200)
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
      .subscribe()

    // 实时订阅新消息
    const msgChannel = supabase
      .channel('dashboard-messages')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `merchant_id=eq.${merchant.id}` },
        (payload) => {
          if ((payload.new as { sender: string }).sender === 'customer') {
            setUnreadMsgCount(c => c + 1)
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <span className="spinner" />
      </div>
    )
  }

  const completedOrders = todayOrders.filter(o => o.status === 'completed')
  const todayRevenue = completedOrders.reduce((sum, o) => sum + Number(o.total_amount), 0)
  const pendingCount = todayOrders.filter(o => o.status === 'pending' || o.after_sales_status === 'pending').length

  return (
    <div style={{ minHeight: '100vh', background: 'var(--color-bg)' }}>
      {/* 顶部栏 */}
      <header style={{
        background: 'white',
        padding: '14px 20px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        borderBottom: '1px solid var(--color-border)',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <ChefHat size={24} color="#f59e0b" />
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontWeight: '800', fontSize: '18px', color: '#1c1917' }}>
              {merchant?.shop_name}
            </span>
            {merchant?.rating && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px', background: '#fef3c7', padding: '2px 6px', borderRadius: '4px' }}>
                <Star fill="#f59e0b" color="#f59e0b" size={12} />
                <span style={{ fontSize: '12px', color: '#d97706', fontWeight: '800' }}>{merchant.rating.toFixed(1)}</span>
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            onClick={copyShareLink}
            className="btn btn-sm"
            style={{
              background: copied ? '#22c55e' : '#f59e0b',
              color: 'white', border: 'none',
            }}
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? '已复制' : '分享链接'}
          </button>
        </div>
      </header>

      {/* 数据概览 */}
      <div style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '24px', fontWeight: '700', color: '#f59e0b' }}>
            {todayOrders.length}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>今日订单</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '24px', fontWeight: '700', color: '#22c55e' }}>
            {formatPrice(todayRevenue)}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>今日营收</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '24px', fontWeight: '700', color: pendingCount > 0 ? '#ef4444' : '#a8a29e' }}>
            {pendingCount}
          </div>
          <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>待处理</div>
        </div>
      </div>

      {/* 快捷导航 */}
      <div style={{ padding: '0 20px 16px', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
        <Link href="/menu" style={{ textDecoration: 'none' }}>
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}>
            <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: '#fff7ed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <UtensilsCrossed size={22} color="#f59e0b" />
            </div>
            <div>
              <div style={{ fontWeight: '600', fontSize: '15px' }}>菜单管理</div>
              <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>管理菜品和分类</div>
            </div>
          </div>
        </Link>
        <Link href="/orders" style={{ textDecoration: 'none' }}>
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}>
            <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ClipboardList size={22} color="#3b82f6" />
            </div>
            <div>
              <div style={{ fontWeight: '600', fontSize: '15px' }}>订单管理</div>
              <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>查看和处理订单</div>
            </div>
          </div>
        </Link>
        <Link href="/customers" style={{ textDecoration: 'none' }}>
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}>
            <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: '#f0fdf4', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Users size={22} color="#22c55e" />
            </div>
            <div>
              <div style={{ fontWeight: '600', fontSize: '15px' }}>客户管理</div>
              <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>客户信息和积分</div>
            </div>
          </div>
        </Link>
        <Link href="/settings" style={{ textDecoration: 'none' }}>
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}>
            <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: '#faf5ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Settings size={22} color="#7c3aed" />
            </div>
            <div>
              <div style={{ fontWeight: '600', fontSize: '15px' }}>店铺设置</div>
              <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>接单控制、收款码</div>
            </div>
          </div>
        </Link>
        <Link href="/coupons" style={{ textDecoration: 'none' }}>
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}>
            <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: '#fff7ed', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Tag size={22} color="#f59e0b" />
            </div>
            <div>
              <div style={{ fontWeight: '600', fontSize: '15px' }}>优惠券</div>
              <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>创建和管理优惠券</div>
            </div>
          </div>
        </Link>
        <Link href="/messages" style={{ textDecoration: 'none' }}>
          <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', position: 'relative' }}>
            <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: '#fef2f2', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <MessageSquare size={22} color="#ef4444" />
            </div>
            <div>
              <div style={{ fontWeight: '600', fontSize: '15px' }}>客户消息</div>
              <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>评论与留言</div>
            </div>
            {unreadMsgCount > 0 && (
              <span style={{
                position: 'absolute', top: '8px', right: '8px',
                background: '#ef4444', color: 'white',
                borderRadius: '20px', padding: '2px 7px',
                fontSize: '11px', fontWeight: '700',
              }}>{unreadMsgCount}</span>
            )}
          </div>
        </Link>
      </div>

      {/* 最新订单 */}
      <div style={{ padding: '0 20px 100px' }}>
        <h2 style={{ fontSize: '16px', fontWeight: '700', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Clock size={18} /> 最新订单
        </h2>
        {todayOrders.length === 0 ? (
          <div className="empty-state">
            <TrendingUp />
            <p>今天还没有订单</p>
            <p style={{ fontSize: '13px', marginTop: '4px' }}>分享链接给客户开始接单吧！</p>
          </div>
        ) : (
          [...todayOrders].sort((a, b) => {
            if (a.after_sales_status === 'pending' && b.after_sales_status !== 'pending') return -1;
            if (a.after_sales_status !== 'pending' && b.after_sales_status === 'pending') return 1;
            return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          }).slice(0, 5).map(order => (
            <div key={order.id} onClick={() => setSelectedOrder(order)} style={{ cursor: 'pointer' }}>
              <div className="card animate-fade-in" style={{ marginBottom: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                    <span className={`tag tag-${order.order_type === 'personal' ? 'personal' : 'company'}`}>
                      {order.order_type === 'personal' ? '个人' : '公司'}
                    </span>
                    <span style={{ fontWeight: '600' }}>{order.customer_name}</span>
                    <span style={{ color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                      {lastFourDigits(order.phone)}
                    </span>
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--color-text-secondary)', marginTop: '4px' }}>
                    {formatPrice(Number(order.total_amount))}
                  </div>
                </div>
                <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span className={`tag tag-status tag-${order.status}`}>
                      {
                        { pending: '待处理', preparing: '制作中', delivering: '配送中', completed: '已完成', cancelled: '已取消' }[order.status]
                      }
                    </span>
                    {order.after_sales_status === 'pending' && (
                      <span className="tag urgent-tag-pulse">
                        ! 请求售后 {order.after_sales_urge_count > 0 && `(客户已催处理 ${order.after_sales_urge_count} 次)`}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 悬浮按钮 */}
      <button className="fab" onClick={() => setSidebarOpen(true)}>
        <Menu size={24} />
      </button>

      {/* 侧边栏 */}
      {sidebarOpen && (
        <>
          <div className="overlay" onClick={() => setSidebarOpen(false)} />
          <div className="sidebar animate-fade-in">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px' }}>
              <h3 style={{ fontSize: '18px', fontWeight: '700' }}>{merchant?.shop_name}</h3>
              <button onClick={() => setSidebarOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                <X size={22} />
              </button>
            </div>
            <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {[
                { href: '/dashboard', icon: <TrendingUp size={20} />, label: '仪表盘' },
                { href: '/menu', icon: <UtensilsCrossed size={20} />, label: '菜单管理' },
                { href: '/orders', icon: <ClipboardList size={20} />, label: '订单管理' },
                { href: '/customers', icon: <Users size={20} />, label: '客户管理' },
                { href: '/coupons', icon: <Tag size={20} />, label: '优惠券' },
                { href: '/settings', icon: <Settings size={20} />, label: '店铺设置' },
              ].map(item => (
                <Link key={item.href} href={item.href} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px',
                    borderRadius: '10px', transition: 'background 0.2s', cursor: 'pointer',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f5f4')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = '')}
                  >
                    {item.icon}
                    <span style={{ fontWeight: '500' }}>{item.label}</span>
                  </div>
                </Link>
              ))}
            </nav>
            <div style={{ position: 'absolute', bottom: '24px', left: '24px', right: '24px' }}>
              <button onClick={handleLogout} className="btn btn-outline btn-block" style={{ color: '#ef4444' }}>
                <LogOut size={16} /> 退出登录
              </button>
            </div>
          </div>
        </>
      )}

      <OrderManagerModal 
        order={selectedOrder} 
        onClose={() => setSelectedOrder(null)} 
        onSuccess={() => {
          setSelectedOrder(null)
          loadData()
        }}
      />
    </div>
  )
}

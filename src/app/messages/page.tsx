'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { Message, Order } from '@/lib/types'
import { ArrowLeft, MessageSquare, User, Phone, X, ShoppingBag } from 'lucide-react'
import { ChatView } from '@/components/common/ChatView'
import OrderManagerModal from '@/components/OrderManagerModal'
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { format } from "date-fns"


interface MessageGroup {
  order_id: string
  order: Order
  customer_name: string
  phone: string
  messages: Message[]
  unreadCount: number
}

export default function MessagesPage() {
  const supabase = createClient()
  const router = useRouter()
  const [merchantId, setMerchantId] = useState<string | null>(null)
  const [groups, setGroups] = useState<MessageGroup[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedGroup, setSelectedGroup] = useState<MessageGroup | null>(null)
  const [showOrderModal, setShowOrderModal] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)

  const loadMessages = useCallback(async (mid: string) => {
    // 获取该商家所有消息，关联 orders 取客户信息
    const { data } = await supabase
      .from('messages')
      .select('*, orders(*)')
      .eq('merchant_id', mid)
      .order('created_at', { ascending: true })

    if (!data) return

    // 按 order_id 分组
    const map: Record<string, MessageGroup> = {}
    for (const msg of data) {
      const order = msg.orders as unknown as Order
      if (!map[msg.order_id]) {
        map[msg.order_id] = {
          order_id: msg.order_id,
          order: order,
          customer_name: order?.customer_name || '未知客户',
          phone: order?.phone || '',
          messages: [],
          unreadCount: 0,
        }
      }
      map[msg.order_id].messages.push(msg as Message)
      if (!msg.is_read_by_merchant && msg.sender === 'customer') {
        map[msg.order_id].unreadCount++
      }
    }

    // 按最新消息时间排序（有未读的置顶）
    const sorted = Object.values(map).sort((a, b) => {
      if (a.unreadCount > 0 && b.unreadCount === 0) return -1
      if (a.unreadCount === 0 && b.unreadCount > 0) return 1
      const aLast = a.messages[a.messages.length - 1]?.created_at || ''
      const bLast = b.messages[b.messages.length - 1]?.created_at || ''
      return bLast.localeCompare(aLast)
    })

    setGroups(sorted)
    // 更新已展开的对话
    if (selectedGroup) {
      const updated = sorted.find(g => g.order_id === selectedGroup.order_id)
      if (updated) setSelectedGroup(updated)
    }
  }, [supabase, selectedGroup])

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/login'); return }
      const { data: m } = await supabase.from('merchants').select('id').eq('user_id', user.id).single()
      if (!m) { router.push('/login'); return }
      setMerchantId(m.id)
      await loadMessages(m.id)
      setLoading(false)
    }
    init()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 实时订阅新消息
  useEffect(() => {
    if (!merchantId) return
    const channel = supabase
      .channel('messages-realtime')
      .on('postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `merchant_id=eq.${merchantId}` },
        () => loadMessages(merchantId)
      ).subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [merchantId, loadMessages, supabase])

  async function openGroup(group: MessageGroup) {
    setSelectedGroup(group)
    setReplyText('')
    // 标记该对话里客户消息为已读
    const unreadIds = group.messages
      .filter(m => m.sender === 'customer' && !m.is_read_by_merchant)
      .map(m => m.id)
    if (unreadIds.length > 0 && merchantId) {
      await supabase.from('messages').update({ is_read_by_merchant: true }).in('id', unreadIds)
      await loadMessages(merchantId)
    }
  }

  async function sendReply() {
    if (!replyText.trim() || !selectedGroup || !merchantId) return
    setSending(true)
    await supabase.from('messages').insert({
      order_id: selectedGroup.order_id,
      merchant_id: merchantId,
      sender: 'merchant',
      content: replyText.trim(),
      rating: null,
      msg_type: 'normal',
      is_read_by_merchant: true,
      is_read_by_customer: false,
    })
    setReplyText('')
    await loadMessages(merchantId)
    setSending(false)
  }

  const totalUnread = groups.reduce((s, g) => s + g.unreadCount, 0)

  if (loading) return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50/50">
      <div className="spinner border-orange-500" />
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-50/50 font-sans pb-20 text-slate-900">
      {/* 顶部导航 */}
      <header className="fixed top-0 left-0 right-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-100 flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={() => router.back()} className="p-2 hover:bg-slate-100 rounded-full transition-colors active:scale-95">
            <ArrowLeft size={20} className="text-slate-600" />
          </button>
          <div className="flex flex-col">
            <h1 className="text-base font-black tracking-tight leading-none flex items-center gap-2">
              客户消息
              {totalUnread > 0 && (
                <span className="bg-rose-500 text-white text-[10px] px-2 py-0.5 rounded-full font-bold shadow-sm shadow-rose-200 animate-pulse">
                  {totalUnread} 未读
                </span>
              )}
            </h1>
          </div>
        </div>
      </header>

      {/* 消息列表区 */}
      <main className="px-4 pt-20 pb-6 max-w-2xl mx-auto">
        {groups.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-20 bg-white rounded-[2.5rem] border-2 border-dashed border-slate-100 shadow-sm mt-4">
            <div className="size-20 bg-slate-50 rounded-full flex items-center justify-center mb-5 ring-8 ring-slate-50/50">
              <MessageSquare size={40} className="text-slate-300" />
            </div>
            <h3 className="font-black text-slate-900 text-lg">暂无客户消息</h3>
            <p className="text-xs text-slate-400 font-medium mt-1 uppercase tracking-widest">随时准备为您解答</p>
          </div>
        ) : (
          <div className="space-y-3">
            {groups.map(group => {
              const lastMsg = group.messages[group.messages.length - 1]
              return (
                <div
                  key={group.order_id}
                  onClick={() => openGroup(group)}
                  className={cn(
                    "group relative bg-white rounded-3xl p-4 flex gap-4 transition-all duration-300 hover:shadow-xl hover:-translate-y-0.5 cursor-pointer active:scale-[0.98]",
                    group.unreadCount > 0 ? "border-2 border-rose-100 shadow-sm shadow-rose-50" : "border border-slate-100"
                  )}
                >
                  {/* 头像区域 */}
                  <div className="relative shrink-0">
                    <div className={cn(
                      "size-12 rounded-2xl flex items-center justify-center text-white shadow-inner",
                      group.unreadCount > 0 ? "bg-gradient-to-br from-rose-400 to-rose-500" : "bg-gradient-to-br from-slate-200 to-slate-300"
                    )}>
                      <User size={24} />
                    </div>
                    {group.unreadCount > 0 && (
                      <div className="absolute -top-1 -right-1 size-5 bg-white rounded-full flex items-center justify-center">
                        <span className="size-4 bg-rose-500 rounded-full flex items-center justify-center text-white text-[10px] font-bold ring-2 ring-white">
                          {group.unreadCount}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* 内容区域 */}
                  <div className="flex-1 min-w-0 flex flex-col justify-center">
                    <div className="flex items-center justify-between mb-1">
                      <h3 className="font-bold text-slate-900 truncate pr-2">{group.customer_name}</h3>
                      {lastMsg && (
                        <span className="text-[11px] text-slate-400 whitespace-nowrap shrink-0">
                          {format(new Date(lastMsg.created_at), 'HH:mm')}
                        </span>
                      )}
                    </div>
                    
                    <div className="flex items-center gap-2">
                      <div className="flex-1 truncate text-sm text-slate-500 font-medium">
                        {lastMsg ? (
                          <span className={cn(group.unreadCount > 0 && "text-rose-600 font-semibold")}>
                            {lastMsg.sender === 'merchant' ? '我: ' : ''}{lastMsg.content}
                          </span>
                        ) : '暂无消息'}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>

      {/* 聊天抽屉 */}
      {selectedGroup && (
        <div className="fixed inset-0 z-50 flex flex-col justify-end pointer-events-none">
          {/* 背景遮罩 */}
          <div 
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm transition-opacity pointer-events-auto animate-in fade-in duration-300"
            onClick={() => setSelectedGroup(null)}
          />
          
          {/* 抽屉主体 */}
          <div className="relative w-full max-w-2xl mx-auto bg-slate-50 rounded-t-[2.5rem] flex flex-col pointer-events-auto h-[85vh] animate-in slide-in-from-bottom-[100%] duration-300 shadow-2xl overflow-hidden">
            {/* 抽屉头部 */}
            <div className="bg-white/80 backdrop-blur-md px-6 py-4 flex items-center justify-between border-b border-slate-100 z-10 sticky top-0 shrink-0">
              <div className="flex items-center gap-3">
                <div className="size-10 bg-slate-100 rounded-2xl flex items-center justify-center text-slate-500">
                  <User size={20} />
                </div>
                <div>
                  <h2 className="font-black text-slate-900 leading-tight">{selectedGroup.customer_name}</h2>
                  <div className="flex items-center gap-1 text-[11px] text-slate-500 mt-0.5 font-medium">
                    <Phone size={10} />
                    <span>{selectedGroup.phone}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button 
                  onClick={() => setShowOrderModal(true)}
                  variant="outline"
                  size="sm"
                  className="rounded-full h-8 px-3 text-xs font-bold text-slate-600 border-slate-200 hover:bg-slate-100 hover:text-slate-900 shadow-sm"
                >
                  <ShoppingBag size={14} className="mr-1.5" />
                  查看订单
                </Button>
                <button 
                  onClick={() => setSelectedGroup(null)}
                  className="size-8 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center hover:bg-slate-200 hover:text-slate-700 transition-colors active:scale-95"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* 消息列表 + 输入区 */}
            <ChatView
              messages={selectedGroup.messages}
              currentUserRole="merchant"
              value={replyText}
              onChange={setReplyText}
              onSend={sendReply}
              sending={sending}
              placeholder="回复客户..."
              scrollAreaClassName="flex-1"
              showInput={!['pending', 'cancelled'].includes(selectedGroup.order.status)}
            />

          </div>
        </div>
      )}

      {/* 订单详情弹窗 */}
      {showOrderModal && selectedGroup?.order && (
        <OrderManagerModal
          order={selectedGroup.order}
          onClose={() => setShowOrderModal(false)}
          onSuccess={() => {
            setShowOrderModal(false)
            if (merchantId) loadMessages(merchantId)
          }}
        />
      )}
    </div>
  )
}

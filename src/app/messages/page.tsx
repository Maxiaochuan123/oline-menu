'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { Message } from '@/lib/types'
import { ArrowLeft, MessageSquare, Star, Send, CheckCheck } from 'lucide-react'

interface MessageGroup {
  order_id: string
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
  const [replyText, setReplyText] = useState('')
  const [sending, setSending] = useState(false)

  const loadMessages = useCallback(async (mid: string) => {
    // 获取该商家所有消息，关联 orders 取客户信息
    const { data } = await supabase
      .from('messages')
      .select('*, orders(customer_name, phone)')
      .eq('merchant_id', mid)
      .order('created_at', { ascending: true })

    if (!data) return

    // 按 order_id 分组
    const map: Record<string, MessageGroup> = {}
    for (const msg of data) {
      const order = (msg as Message & { orders?: { customer_name: string; phone: string } }).orders
      if (!map[msg.order_id]) {
        map[msg.order_id] = {
          order_id: msg.order_id,
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
      is_read_by_merchant: true,
      is_read_by_customer: false,
    })
    setReplyText('')
    await loadMessages(merchantId)
    setSending(false)
  }

  const totalUnread = groups.reduce((s, g) => s + g.unreadCount, 0)

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
        <span style={{ fontWeight: '700', fontSize: '17px' }}>客户消息</span>
        {totalUnread > 0 && (
          <span style={{
            background: '#ef4444', color: 'white',
            borderRadius: '20px', padding: '2px 8px',
            fontSize: '12px', fontWeight: '700',
          }}>{totalUnread} 未读</span>
        )}
      </header>

      <div style={{ padding: '12px 16px 80px' }}>
        {groups.length === 0 ? (
          <div className="empty-state">
            <MessageSquare />
            <p>暂无客户消息</p>
          </div>
        ) : (
          groups.map(group => (
            <div
              key={group.order_id}
              className="card"
              style={{
                marginBottom: '10px', cursor: 'pointer',
                borderLeft: group.unreadCount > 0 ? '3px solid #ef4444' : '3px solid #e5e7eb',
                background: group.unreadCount > 0 ? '#fff5f5' : 'white',
              }}
              onClick={() => openGroup(group)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: '700', fontSize: '15px', marginBottom: '4px' }}>
                    {group.customer_name}
                    <span style={{ fontSize: '12px', color: '#999', fontWeight: '400', marginLeft: '6px' }}>{group.phone}</span>
                  </div>
                  {/* 最新一条消息预览 */}
                  {group.messages.length > 0 && (() => {
                    const last = group.messages[group.messages.length - 1]
                    return (
                      <div style={{ fontSize: '13px', color: '#666', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', maxWidth: '200px' }}>
                        {last.sender === 'merchant' ? '我：' : ''}{last.content}
                      </div>
                    )
                  })()}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' }}>
                  {group.unreadCount > 0 && (
                    <span style={{
                      background: '#ef4444', color: 'white',
                      borderRadius: '50%', width: '20px', height: '20px',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: '11px', fontWeight: '700',
                    }}>{group.unreadCount}</span>
                  )}
                  <span style={{ fontSize: '11px', color: '#999' }}>
                    {group.messages.length} 条
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* 对话详情抽屉 */}
      {selectedGroup && (
        <>
          <div className="overlay" style={{ zIndex: 100 }} onClick={() => setSelectedGroup(null)} />
          <div style={{
            position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 110,
            background: 'white', borderRadius: '20px 20px 0 0',
            maxHeight: '80vh', display: 'flex', flexDirection: 'column',
            boxShadow: '0 -4px 30px rgba(0,0,0,0.15)',
          }}>
            {/* 抽屉头 */}
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
              <div style={{ fontWeight: '700', fontSize: '16px' }}>{selectedGroup.customer_name}</div>
              <div style={{ fontSize: '12px', color: '#999' }}>{selectedGroup.phone}</div>
            </div>

            {/* 消息列表 */}
            <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
              {selectedGroup.messages.map(msg => (
                <MessageBubble key={msg.id} msg={msg} />
              ))}
            </div>

            {/* 回复输入框 */}
            <div style={{
              padding: '12px 16px',
              borderTop: '1px solid var(--color-border)',
              display: 'flex', gap: '8px', alignItems: 'flex-end',
              flexShrink: 0,
            }}>
              <textarea
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                placeholder="回复客户..."
                rows={2}
                style={{
                  flex: 1, border: '1px solid var(--color-border)',
                  borderRadius: '12px', padding: '10px 12px',
                  resize: 'none', fontSize: '14px', fontFamily: 'inherit',
                  outline: 'none',
                }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply() } }}
              />
              <button
                onClick={sendReply}
                disabled={sending || !replyText.trim()}
                className="btn btn-primary"
                style={{ height: '44px', width: '44px', padding: 0, borderRadius: '50%', flexShrink: 0 }}
              >
                <Send size={18} />
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function MessageBubble({ msg }: { msg: Message }) {
  const isMerchant = msg.sender === 'merchant'
  return (
    <div style={{
      display: 'flex',
      justifyContent: isMerchant ? 'flex-end' : 'flex-start',
      marginBottom: '12px',
    }}>
      <div style={{ maxWidth: '75%' }}>
        {/* 星级评分（仅客户带评分的消息显示） */}
        {!isMerchant && msg.rating && (
          <div style={{ display: 'flex', gap: '2px', marginBottom: '4px' }}>
            {Array.from({ length: 5 }).map((_, i) => (
              <Star key={i} size={14} fill={i < msg.rating! ? '#f97316' : 'none'} color={i < msg.rating! ? '#f97316' : '#d1d5db'} />
            ))}
          </div>
        )}
        <div style={{
          padding: '10px 14px',
          borderRadius: isMerchant ? '18px 4px 18px 18px' : '4px 18px 18px 18px',
          background: isMerchant ? 'var(--color-primary)' : '#f3f4f6',
          color: isMerchant ? 'white' : '#1c1917',
          fontSize: '14px', lineHeight: '1.5',
        }}>
          {msg.content}
        </div>
        <div style={{
          fontSize: '11px', color: '#9ca3af', marginTop: '3px',
          textAlign: isMerchant ? 'right' : 'left',
          display: 'flex', alignItems: 'center', gap: '3px',
          justifyContent: isMerchant ? 'flex-end' : 'flex-start',
        }}>
          {new Date(msg.created_at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          {isMerchant && msg.is_read_by_customer && <CheckCheck size={12} color="#22c55e" />}
        </div>
      </div>
    </div>
  )
}

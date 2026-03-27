'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { AlertTriangle, CheckCircle, ChevronRight, MessageSquare } from 'lucide-react'
import Image from 'next/image'
import { useToast } from '@/components/common/Toast'
import { formatPrice, cn } from '@/lib/utils'
import { calculateCancellationPenalty } from '@/lib/order'
import OrderItemsCard from '@/components/OrderItemsCard'
import type { UsedCoupon } from '@/components/OrderItemsCard'
import type { Order, Message } from '@/lib/types'
import { ChatView } from '@/components/common/ChatView'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Separator } from "@/components/ui/separator"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

/** 扩展的订单项类型，包含菜单项的分类信息 */
interface ExtendedOrderItem {
  id: string
  order_id: string
  menu_item_id: string
  item_name: string
  item_price: number
  quantity: number
  remark: string | null
  menu_items?: { category_id: string } | null
}

/** 建议退款类型结构 */
interface SuggestedRefund {
  rate: number
  amount: number
  final: number
  reason: string
}

const STATUS_LABELS: Record<string, string> = {
  pending: '待处理',
  preparing: '制作中',
  delivering: '配送中',
  completed: '已完成',
  cancelled: '已取消'
}
const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700 border-amber-200",
  preparing: "bg-blue-100 text-blue-700 border-blue-200",
  delivering: "bg-purple-100 text-purple-700 border-purple-200",
  completed: "bg-emerald-100 text-emerald-700 border-emerald-200",
  cancelled: "bg-zinc-100 text-zinc-700 border-zinc-200",
}
const STATUS_FLOW = ['pending', 'preparing', 'delivering', 'completed']
const REFUND_MODES = [
  { value: 'fixed' as const, label: '按金额' },
  { value: 'ratio' as const, label: '按比例' },
  { value: 'items' as const, label: '按菜品' },
]

/** 可复用的信息字段展示组件 */
function InfoField({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-[11px] uppercase tracking-widest text-slate-400 font-black">{label}</Label>
      {children}
    </div>
  )
}

/** 售后状态展示组件 */
function AfterSalesStatusCard({ 
  order, 
  orderItems, 
  usedCoupons, 
  onHandleRefund 
}: { 
  order: Order, 
  orderItems: ExtendedOrderItem[], 
  usedCoupons: UsedCoupon[],
  onHandleRefund: () => void 
}) {
  if (order.after_sales_status === 'pending') {
    return (
      <Alert variant="destructive" className={cn(
        "border-red-200 bg-red-50/80 shadow-sm",
        (order.after_sales_urge_count || 0) > 0 && "urgent-panel-pulse"
      )}>
        <AlertTriangle size={18} className="text-red-600" />
        <AlertTitle className="text-red-700 font-bold mb-1">
          售后待处理 {(order.after_sales_urge_count || 0) > 0 && `(客户已催处理 ${order.after_sales_urge_count} 次)`}
        </AlertTitle>
        <AlertDescription className="space-y-3">
          <p className="text-red-800 text-sm"><strong>顾客缘由：</strong>{order.after_sales_reason}</p>
          
          {order.after_sales_items && order.after_sales_items.length > 0 && (
            <div className="text-xs text-red-700 bg-white/60 p-2 rounded border border-red-100">
              <strong>不满意菜品：</strong>
              {orderItems.filter(i => order.after_sales_items?.includes(i.id)).map(i => i.item_name).join('、')}
            </div>
          )}

          {order.after_sales_images && order.after_sales_images.length > 0 && (
            <div className="flex gap-2 flex-wrap">
              {order.after_sales_images.map((url: string, idx: number) => (
                <div 
                  key={idx} 
                  className="relative size-14 border border-red-200 rounded-md overflow-hidden cursor-zoom-in hover:brightness-90 transition-all"
                  onClick={() => window.open(url, '_blank')}
                >
                  <Image src={url} alt="凭证" fill unoptimized className="object-cover" />
                </div>
              ))}
            </div>
          )}
          
          <Button 
            variant="destructive" 
            className="w-full h-9 shadow-sm font-bold"
            onClick={onHandleRefund}
          >
            去处理退款/驳回
          </Button>
        </AlertDescription>
      </Alert>
    )
  }

  if (order.after_sales_status === 'resolved') {
    return (
      <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 shadow-sm text-sm font-medium">
        <div className="flex items-center gap-2 text-emerald-700 font-black mb-3 text-base">
          <CheckCircle size={18} /> 已完结售后
        </div>
        <div className="flex justify-between items-center">
          <span className="text-slate-600">已退款金额</span>
          <span className="text-lg font-black text-emerald-600 font-mono tracking-tighter">{formatPrice(Number(order.refund_amount))}</span>
        </div>
        {order.is_coupon_refunded && (
          <div className="mt-3 p-3 bg-white/60 border border-emerald-200 rounded-xl flex gap-3 items-center">
            <Badge className="bg-emerald-100 text-emerald-700 hover:bg-emerald-100 border-none px-2 py-0.5 font-black">🏷️ 优惠券已退</Badge>
            <div className="text-xs text-emerald-600 truncate flex-1 font-bold">
              {usedCoupons.length > 0 ? usedCoupons.map(c => c.title).join(' + ') : '优惠券'} (抵扣 {formatPrice(Number(order.coupon_discount_amount || 0))})
            </div>
          </div>
        )}
      </div>
    )
  }

  return null
}

/** 订单基本信息展示组件 */
function OrderDetailsCard({ order, orderItems, usedCoupons }: { order: Order, orderItems: ExtendedOrderItem[], usedCoupons: UsedCoupon[] }) {
  return (
    <Card className="border-none shadow-sm overflow-hidden bg-white ring-1 ring-black/5 py-0">
      <CardContent className="p-5 space-y-4">
        <div className="grid grid-cols-2 gap-x-6 gap-y-5">
          <InfoField label="客户姓名">
            <p className="text-sm font-black text-slate-900">{order.customer_name}</p>
          </InfoField>
          <InfoField label="联系电话">
            <p className="text-sm font-black text-slate-900">{order.phone}</p>
          </InfoField>
          <InfoField label="配送地址" className="col-span-2 pt-1">
            <p className="text-sm font-semibold text-slate-700 leading-relaxed bg-slate-50/80 p-2.5 rounded-xl border border-slate-100/50">{order.address}</p>
          </InfoField>
          <InfoField label="预约送达">
            <p className="text-sm font-bold text-orange-600">{new Date(order.scheduled_time).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</p>
          </InfoField>
          <InfoField label="用户身份">
            <div className="flex gap-2">
               <Badge variant="secondary" className={cn("text-[10px] px-2 py-0.5 rounded-md", order.order_type === 'personal' ? "bg-blue-100 text-blue-700 border-none font-black" : "bg-purple-100 text-purple-700 border-none font-black")}>
                 {order.order_type === 'personal' ? '个人用餐' : '企业商务'}
               </Badge>
            </div>
          </InfoField>
        </div>
        
        <Separator className="bg-slate-100" />
        
        <OrderItemsCard
          title="菜品明细"
          titleAsHeading={false}
          items={orderItems}
          showRemark
          usedCoupons={usedCoupons}
          couponDiscountAmount={Number(order.coupon_discount_amount || 0)}
          vipDiscountAmount={Number(order.vip_discount_amount || 0)}
          originalAmount={Number(order.total_amount) + Number(order.coupon_discount_amount || 0) + Number(order.vip_discount_amount || 0)}
          totalAmount={Number(order.total_amount)}
          createdAt={order.created_at}
          penaltyRate={order.penalty_rate}
          penaltyAmount={order.penalty_amount}
          totalColor="text-orange-600"
        />
      </CardContent>
    </Card>
  )
}


/** 退款协商控制台组件 */
function RefundConsoleDialog({
  open,
  onOpenChange,
  order,
  suggestedRefund,
  refundMode,
  setRefundMode,
  refundInput,
  setRefundInput,
  orderItems,
  selectedRefundItems,
  setSelectedRefundItems,
  usedCoupons,
  selectedCouponRefundIds,
  setSelectedCouponRefundIds,
  onReject,
  onConfirm,
  currentRefundTotal,
  isProcessing
}: {
  open: boolean,
  onOpenChange: (open: boolean) => void,
  order: Order,
  suggestedRefund: SuggestedRefund | null,
  refundMode: 'fixed' | 'ratio' | 'items',
  setRefundMode: (mode: 'fixed' | 'ratio' | 'items') => void,
  refundInput: string,
  setRefundInput: (v: string) => void,
  orderItems: ExtendedOrderItem[],
  selectedRefundItems: Record<string, number>,
  setSelectedRefundItems: React.Dispatch<React.SetStateAction<Record<string, number>>>,
  usedCoupons: UsedCoupon[],
  selectedCouponRefundIds: Set<string>,
  setSelectedCouponRefundIds: React.Dispatch<React.SetStateAction<Set<string>>>,
  onReject: () => void,
  onConfirm: () => void,
  currentRefundTotal: () => number,
  isProcessing: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] border-none shadow-2xl p-0 overflow-hidden bg-slate-50 rounded-3xl">
        <DialogHeader className="p-6 bg-white border-b flex-shrink-0">
          <DialogTitle className="text-2xl font-black tracking-tight">退款协商控制台</DialogTitle>
        </DialogHeader>
        
        <ScrollArea className="max-h-[60vh]">
          <div className="p-6 space-y-6">
            <div className="bg-white rounded-2xl p-5 shadow-sm ring-1 ring-slate-100 space-y-4">
              <div className="flex justify-between items-center text-sm">
                <span className="font-bold text-slate-400 uppercase tracking-widest">订单实付总额</span>
                <span className="font-black text-slate-800 text-base tracking-tight font-mono">{formatPrice(Number(order.total_amount))}</span>
              </div>
              {suggestedRefund && suggestedRefund.rate > 0 && (
                <div className="p-4 bg-orange-50 rounded-2xl border border-orange-100 space-y-3 shadow-[inner_0_2px_4px_rgba(0,0,0,0.01)]">
                  <div className="flex justify-between text-xs font-black text-orange-700">
                    <span className="flex items-center gap-1.5"><AlertTriangle size={12} /> 智算中心建议扣除损耗 ({(suggestedRefund.rate * 100).toFixed(0)}%)</span>
                    <span className="font-mono text-sm">-{formatPrice(suggestedRefund.amount)}</span>
                  </div>
                  <p className="text-[10px] text-orange-600/80 leading-relaxed font-bold border-l-2 border-orange-200 pl-2">原因：{suggestedRefund.reason}</p>
                  <Separator className="bg-orange-200/40" />
                  <div className="flex justify-between items-center pt-1">
                    <span className="text-xs font-black text-orange-800 uppercase tracking-tight">建议最优退款值</span>
                    <span className="text-2xl font-black text-orange-600 font-mono tracking-tighter leading-none">{formatPrice(suggestedRefund.final)}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="flex p-1.5 bg-slate-200/60 rounded-2xl ring-1 ring-black/5">
               {REFUND_MODES.map(mode => (
                 <Button 
                   key={mode.value}
                   variant={refundMode === mode.value ? 'secondary' : 'ghost'} 
                   className={cn("flex-1 h-9 text-xs font-black rounded-xl transition-all", refundMode === mode.value ? "bg-white shadow-md text-orange-600" : "text-slate-500 hover:bg-white/20")}
                   onClick={() => setRefundMode(mode.value)}
                 >{mode.label}</Button>
               ))}
            </div>

            <div className="space-y-4">
              {refundMode === 'fixed' && (
                <div className="space-y-2.5">
                  <Label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">拟定退款绝对值 (固定金额)</Label>
                  <div className="relative">
                     <Input type="number" value={refundInput} onChange={e => setRefundInput(e.target.value)} className="font-mono text-2xl font-black h-16 bg-white rounded-2xl shadow-sm border-slate-100 focus-visible:ring-orange-500 transition-all font-bold" />
                  </div>
                </div>
              )}
              {refundMode === 'ratio' && (
                <div className="space-y-2.5">
                  <Label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">按订单实付比例结算 (%)</Label>
                  <div className="relative">
                    <Input type="number" value={refundInput} onChange={e => setRefundInput(e.target.value)} className="font-mono text-2xl font-black h-16 bg-white rounded-2xl shadow-sm border-slate-100 focus-visible:ring-orange-500 px-6 transition-all font-bold" placeholder="0-100" />
                    <span className="absolute right-6 top-1/2 -translate-y-1/2 text-slate-300 font-black">%</span>
                  </div>
                </div>
              )}
              {refundMode === 'items' && (
                <div className="space-y-3">
                  <Label className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">智能勾选退款明细</Label>
                  <Card className="border-none shadow-sm rounded-2xl overflow-hidden bg-white ring-1 ring-slate-100">
                    <div className="divide-y divide-slate-50">
                      {orderItems.map(item => {
                        const currentQty = selectedRefundItems[item.id] || 0
                        return (
                          <div key={item.id} className="flex items-center justify-between py-3.5 px-4 hover:bg-slate-50/50 transition-colors">
                            <div className="flex items-center gap-3.5">
                              <Checkbox 
                                className="rounded data-[state=checked]:bg-orange-500 data-[state=checked]:border-orange-500"
                                checked={currentQty > 0} 
                                onCheckedChange={(checked) => setSelectedRefundItems(prev => ({ ...prev, [item.id]: checked ? item.quantity : 0 }))} 
                              />
                              <div className="space-y-1">
                                <p className="text-sm font-black text-slate-700 leading-none">{item.item_name}</p>
                                <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tight">原购数量: {item.quantity} · 单价: {formatPrice(item.item_price)}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-5">
                              <div className="flex items-center ring-1 ring-slate-200 rounded-lg overflow-hidden h-8 bg-slate-50/50">
                                <Button variant="ghost" className="size-8 p-0 rounded-none text-slate-400 hover:text-slate-600" disabled={currentQty <= 1} onClick={() => setSelectedRefundItems(p => ({ ...p, [item.id]: p[item.id] - 1 }))}>-</Button>
                                <span className="text-xs font-black w-7 text-center">{currentQty}</span>
                                <Button variant="ghost" className="size-8 p-0 rounded-none text-slate-400 hover:text-slate-600" disabled={currentQty >= item.quantity} onClick={() => setSelectedRefundItems(p => ({ ...p, [item.id]: (p[item.id] || 0) + 1 }))}>+</Button>
                              </div>
                              <span className="text-xs font-black text-slate-600 w-16 text-right font-mono tracking-tighter">{formatPrice(item.item_price * currentQty)}</span>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </Card>
                </div>
              )}
            </div>

            {usedCoupons.length > 0 && (
              <div className="space-y-3">
                <div className="flex justify-between items-center px-1">
                  <Label className="text-xs font-black text-slate-400 uppercase tracking-widest">退还订单关联优惠券</Label>
                  <span className="text-[10px] font-black text-red-500 bg-red-50 px-2 py-0.5 rounded-full ring-1 ring-red-100/50">已勾选退回给客</span>
                </div>
                <Card className="border-none shadow-sm rounded-2xl overflow-hidden bg-white divide-y divide-slate-50 ring-1 ring-slate-100">
                  {usedCoupons.map((coupon) => {
                    const isChecked = selectedCouponRefundIds.has(coupon.id)
                    return (
                      <label key={coupon.id} className="flex items-center gap-4 px-5 py-4 cursor-pointer hover:bg-slate-50 transition-colors">
                        <Checkbox 
                          className="data-[state=checked]:bg-blue-500 data-[state=checked]:border-blue-500 rounded"
                          checked={isChecked}
                          onCheckedChange={(checked) => {
                            const next = new Set(selectedCouponRefundIds)
                            if (checked) next.add(coupon.id); else next.delete(coupon.id);
                            setSelectedCouponRefundIds(next)
                          }}
                        />
                        <div className="flex-1 space-y-1">
                          <p className={cn("text-sm font-black tracking-tight", isChecked ? "text-blue-600" : "text-slate-700")}>🏷️ {coupon.title}</p>
                          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-tighter opacity-80">抵扣面额: {formatPrice(coupon.amount)}{isChecked ? ' · 将退回至客户账户' : ''}</p>
                        </div>
                      </label>
                    )
                  })}
                </Card>
              </div>
            )}

            <div className="bg-orange-500 rounded-[2.5rem] p-8 shadow-2xl shadow-orange-200 ring-4 ring-orange-500/10 space-y-1 transform scale-100 hover:scale-[1.01] transition-all">
              <p className="text-[10px] font-black text-white/50 uppercase tracking-[0.2em] text-center mb-1">拟同意退款合计总额</p>
              <p className="text-4xl font-black text-white text-center font-mono tracking-tighter drop-shadow-sm">{formatPrice(currentRefundTotal())}</p>
              {currentRefundTotal() >= Number(order.total_amount) && (
                <div className="flex justify-center mt-3">
                  <span className="text-[10px] font-black text-white bg-red-600/30 px-3 py-1 rounded-full ring-1 ring-white/20 animate-pulse">⚠️ 已达最大退款额度限制</span>
                </div>
              )}
            </div>
          </div>
        </ScrollArea>

        <DialogFooter className="p-6 bg-white border-t sm:justify-start gap-4 flex-shrink-0">
          <Button variant="outline" className="flex-1 border-red-100 text-red-600 hover:bg-red-50 rounded-2xl h-12 font-bold transition-all" disabled={isProcessing} onClick={onReject}>驳回售后</Button>
          <Button className="flex-[2] bg-orange-500 hover:bg-orange-600 font-black shadow-xl shadow-orange-100 rounded-2xl h-12 text-base tracking-tight" disabled={isProcessing} onClick={onConfirm}>{isProcessing ? '处理中...' : '同意入账并完结'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function OrderManagerModal({ 
  order, 
  onClose, 
  onSuccess 
}: { 
  order: Order, 
  onClose: () => void, 
  onSuccess: () => void 
}) {
  const supabase = useMemo(() => createClient(), [])
  const { toast } = useToast()
  // 连表后结构：OrderItem & { menu_items: { category_id: string } | null }
  const [orderItems, setOrderItems] = useState<ExtendedOrderItem[]>([])
  
  // 状态流
  const [showRefundPanel, setShowRefundPanel] = useState(false)
  const [refundMode, setRefundMode] = useState<'fixed' | 'ratio' | 'items'>('fixed')
  const [refundInput, setRefundInput] = useState('')
  // 记录选中的退货明细: item.id -> { quantity: number }
  const [selectedRefundItems, setSelectedRefundItems] = useState<Record<string, number>>({})
  const [selectedCouponRefundIds, setSelectedCouponRefundIds] = useState<Set<string>>(new Set())
  const masterCouponCheckboxRef = useRef<HTMLInputElement>(null)
  const [showCancel, setShowCancel] = useState(false)
  const [isConfirmingStatus, setIsConfirmingStatus] = useState(false)
  const [showRefundConfirm, setShowRefundConfirm] = useState(false)
  const [showRejectConfirm, setShowRejectConfirm] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [suggestedRefund, setSuggestedRefund] = useState<{ rate: number, amount: number, final: number, reason: string } | null>(null)

  // 客服聊天（同时接收普通留言与售后流）
  const [messages, setMessages] = useState<Message[]>([])
  const [asMsgText, setAsMsgText] = useState('')
  const [sendingAsMsg, setSendingAsMsg] = useState(false)
  const modalBodyRef = useRef<HTMLDivElement>(null)

  const isInitialMount = useRef(true)

  useEffect(() => {
    if (order) {
      isInitialMount.current = true
      // 强制复位主视图到顶部 (使用微延时对抗子组件初始化造成的强制拉动)
      setTimeout(() => {
        if (modalBodyRef.current) {
          modalBodyRef.current.scrollTop = 0
        }
      }, 50)
    }
  }, [order])

  const [usedCoupons, setUsedCoupons] = useState<UsedCoupon[]>([])

  useEffect(() => {
    if (order) {
      // 连表查询 menu_items 以获取该菜品所属的 category_id
      supabase.from('order_items').select('*, menu_items(category_id)').eq('order_id', order.id).then(({ data }) => {
        setOrderItems(data || [])
        if (data) {
          const initQty: Record<string, number> = {}
          data.forEach(item => {
            initQty[item.id] = item.quantity
          })
          setSelectedRefundItems(initQty)
        }
      })
      const ids: string[] = order.coupon_ids ?? []
      if (ids.length > 0) {
        supabase.from('coupons').select('id, title, amount, target_type, target_category_id, target_item_ids').in('id', ids).then(({ data: couponList }) => {
          setUsedCoupons(couponList || [])
        })
      }
    }
  }, [order, supabase])

  const loadMessages = useCallback(() => {
    if (!order) return
    supabase
      .from('messages')
      .select('*')
      .eq('order_id', order.id)
      .order('created_at', { ascending: true })
      .then(async ({ data }) => {
        setMessages(data || [])
        // 将客户发的消息标记商家已读
        const unreadForMerchant = (data || []).filter((m: Message) => m.sender === 'customer' && !m.is_read_by_merchant)
        if (unreadForMerchant.length > 0) {
          await supabase.from('messages')
            .update({ is_read_by_merchant: true })
            .in('id', unreadForMerchant.map((m: Message) => m.id))
        }
      })
  }, [order, supabase])

  useEffect(() => {
    if (order) {
      loadMessages()

      const channel = supabase
        .channel(`merchant-asm-${order.id}`)
        .on('postgres_changes', {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `order_id=eq.${order.id}`,
        }, (payload) => {
          const nm = payload.new as Message
          setMessages(prev => {
            if (prev.some(m => m.id === nm.id)) return prev
            return [...prev, nm]
          })
          // 标记已读
          if (nm.sender === 'customer') {
            supabase.from('messages').update({ is_read_by_merchant: true }).eq('id', nm.id).then()
          }
        })
        .subscribe()

      return () => { supabase.removeChannel(channel) }
    }
  }, [order, loadMessages, supabase])

  async function handleSendMessage(content?: string, isClosedObj = false) {
    const text = content || asMsgText.trim()
    if (!text || !order) return
    setSendingAsMsg(true)

    // 只有在订单确实处于售后待处理状态时，才标记为协商消息
    const isRealAfterSales = order.after_sales_status === 'pending'
    
    await supabase.from('messages').insert({
      order_id: order.id,
      merchant_id: order.merchant_id,
      sender: 'merchant',
      content: text,
      msg_type: isClosedObj 
        ? 'after_sales_closed' 
        : (isRealAfterSales ? 'after_sales' : 'normal'),
      is_read_by_merchant: true,
      is_read_by_customer: false
    })
    if (!content) setAsMsgText('')
    setSendingAsMsg(false)
  }

  // 包装工具
  const allCouponsSelected = usedCoupons.length > 0 && usedCoupons.every(c => selectedCouponRefundIds.has(c.id))
  const someCouponsSelected = selectedCouponRefundIds.size > 0 && !allCouponsSelected

  // master checkbox indeterminate 实现
  useEffect(() => {
    if (masterCouponCheckboxRef.current) {
      masterCouponCheckboxRef.current.indeterminate = someCouponsSelected
      masterCouponCheckboxRef.current.checked = allCouponsSelected
    }
  }, [selectedCouponRefundIds, usedCoupons, allCouponsSelected, someCouponsSelected])

  // 全额退款自动全选券；部分退款时，若某菜品全退，智能关联勾选包含其名称关键字的优惠券
  useEffect(() => {
    if (!order || !((order.coupon_ids?.length ?? 0) > 0) || usedCoupons.length === 0) return
    let isFullRefund = false
    let autoSelectedIds = new Set<string>()

    if (refundMode === 'items') {
      let allRefunded = true
      const fullyRefundedMenuIds: string[] = []

      orderItems.forEach(i => {
        const qty = selectedRefundItems[i.id] || 0
        if (qty === i.quantity) {
          fullyRefundedMenuIds.push(i.menu_item_id)
        } else {
          allRefunded = false
        }
      })
      isFullRefund = orderItems.length > 0 && allRefunded

      // 智能匹配专项券
      if (!isFullRefund && fullyRefundedMenuIds.length > 0) {
        usedCoupons.forEach(coupon => {
          let hasMatch = false
          if (coupon.target_type === 'category' && coupon.target_item_ids && coupon.target_item_ids.length > 0) {
            hasMatch = coupon.target_item_ids.some(targetId => fullyRefundedMenuIds.includes(targetId))
          } else if (coupon.target_type === 'category' && coupon.target_category_id) {
            const itemsInThisCategory = orderItems.filter(i => i.menu_items?.category_id === coupon.target_category_id)
            if (itemsInThisCategory.length > 0) {
               const allCategoryItemsRefunded = itemsInThisCategory.every(i => fullyRefundedMenuIds.includes(i.menu_item_id))
               if (allCategoryItemsRefunded) hasMatch = true
            }
          } else if (coupon.target_type && coupon.target_type !== 'all') {
             const fullyRefundedNames = fullyRefundedMenuIds.map(id => orderItems.find(i => i.menu_item_id === id)?.item_name || '')
             hasMatch = fullyRefundedNames.some(name => {
               if (!name) return false
               for (let idx = 0; idx < name.length - 1; idx++) {
                 if (coupon.title.includes(name.substring(idx, idx + 2))) return true
               }
               return false
             })
          }
          if (hasMatch) autoSelectedIds.add(coupon.id)
        })
      }
    } else if (refundMode === 'fixed') {
      isFullRefund = Number(refundInput) >= Number(order.total_amount)
    } else if (refundMode === 'ratio') {
      isFullRefund = Number(refundInput) >= 100
    }

    if (isFullRefund) {
      autoSelectedIds = new Set(usedCoupons.map(c => c.id))
    }

    setSelectedCouponRefundIds(prev => {
      if (prev.size === autoSelectedIds.size && [...prev].every(id => autoSelectedIds.has(id))) return prev
      return autoSelectedIds
    })
  }, [selectedRefundItems, refundMode, order, orderItems, refundInput, usedCoupons])

  function currentRefundTotal() {
    if (!order) return 0
    let amt = 0
    if (refundMode === 'fixed') {
      const v = Number(refundInput)
      amt = isNaN(v) ? 0 : v
    }
    else if (refundMode === 'ratio') {
      const p = Number(refundInput)
      if (isNaN(p) || p < 0 || p > 100) return 0
      amt = Number(order.total_amount) * (p / 100)
    }
    else if (refundMode === 'items') {
      let sum = 0
      orderItems.forEach(i => {
        const qty = selectedRefundItems[i.id] || 0
        sum += (i.item_price * qty)
      })
      amt = sum
    }
    return Math.min(amt, Number(order.total_amount))
  }

  async function rollbackCustomerAssets({ couponIdsToRefund, refundAmount, isFullRefund }: {
    couponIdsToRefund: string[]
    refundAmount: number
    isFullRefund: boolean
  }) {
    if (!order.customer_id) return
    if (couponIdsToRefund.length > 0) {
      await supabase
        .from('user_coupons')
        .update({ status: 'unused', used_at: null })
        .eq('customer_id', order.customer_id)
        .in('coupon_id', couponIdsToRefund)
        .eq('status', 'used')
    }
    if (refundAmount > 0) {
      const { data: cust } = await supabase.from('customers').select('points, order_count, total_spent').eq('id', order.customer_id).single()
      if (cust) {
        const pointsToRollback = Math.floor(Number(order.total_amount))
        await supabase.from('customers')
          .update({ 
            points: Math.max(0, (cust.points ?? 0) - pointsToRollback),
            order_count: isFullRefund ? Math.max(0, (cust.order_count ?? 0) - 1) : cust.order_count,
            total_spent: Math.max(0, (cust.total_spent ?? 0) - refundAmount)
          })
          .eq('id', order.customer_id)
      }
    }
  }

  function requestRefundConfirm() {
    const amt = currentRefundTotal()
    if (amt <= 0) return toast('退款金额必须大于 0', 'warning')
    if (amt > Number(order.total_amount)) return toast('退款金额不能大于订单实付额', 'error')
    setShowRefundConfirm(true)
  }

  async function handleConfirmRefund() {
    setIsProcessing(true)
    try {
      const amt = currentRefundTotal()
      const isFullRefund = amt >= Number(order.total_amount)
      const hasCouponRefund = selectedCouponRefundIds.size > 0
      const updatePayload = {
        refund_amount: amt,
        after_sales_status: 'resolved',
        status: isFullRefund ? 'cancelled' : 'completed',
        cancelled_by: isFullRefund ? 'merchant' : order.cancelled_by,
        cancelled_at: isFullRefund ? new Date().toISOString() : order.cancelled_at,
        is_coupon_refunded: hasCouponRefund,
      }

      const { error } = await supabase.from('orders').update(updatePayload).eq('id', order.id)

      if (error) {
        toast('处理失败', 'error')
      } else {
        await rollbackCustomerAssets({
          couponIdsToRefund: hasCouponRefund ? Array.from(selectedCouponRefundIds) : [],
          refundAmount: amt,
          isFullRefund,
        })

        const extInfo = hasCouponRefund ? `\n(已退回 ${
          usedCoupons.filter(c => selectedCouponRefundIds.has(c.id)).map(c => c.title).join('、')
        } 共 ${selectedCouponRefundIds.size} 张优惠券)` : ''
        await handleSendMessage(`商家已同意退款并完结本单售后（退款金额：${formatPrice(amt)}）${extInfo}\n祝您生活愉快~`, true)
        toast('售后处理成功', 'success')
        onSuccess()
        onClose()
      }
    } finally {
      setIsProcessing(false)
      setShowRefundConfirm(false)
    }
  }

  async function handleRejectRefund() {
    setIsProcessing(true)
    try {
      const nextStatus = order.status === 'cancelled' ? 'cancelled' : 'completed'
      await supabase.from('orders').update({ 
        after_sales_status: 'rejected',
        status: nextStatus
      }).eq('id', order.id)
      await handleSendMessage(`抱歉，商家已驳回您的售后申请。\n如有疑问可继续留言沟通。`, true)
      toast('售后申请已驳回', 'warning')
      onSuccess()
      onClose()
    } finally {
      setIsProcessing(false)
      setShowRejectConfirm(false)
    }
  }

  async function cancelOrder() {
    setIsProcessing(true)
    try {
      const { error } = await supabase.from('orders').update({
        status: 'cancelled',
        cancelled_by: 'merchant',
        cancelled_at: new Date().toISOString(),
        refund_amount: order.total_amount,
        penalty_rate: 0,
        penalty_amount: 0,
        is_coupon_refunded: true,
      }).eq('id', order.id)

      if (error) {
        toast('取消失败', 'error')
      } else {
        toast('订单已成功取消', 'success')
        await rollbackCustomerAssets({
          couponIdsToRefund: order.coupon_ids ?? [],
          refundAmount: Number(order.total_amount),
          isFullRefund: true,
        })
        onSuccess()
        onClose()
      }
    } finally {
      setIsProcessing(false)
    }
  }

  async function updateStatus() {
    setIsProcessing(true)
    try {
      const idx = STATUS_FLOW.indexOf(order.status)
      const nextStatus = STATUS_FLOW[idx + 1]
      const { error } = await supabase.from('orders').update({ status: nextStatus }).eq('id', order.id)
      if (error) toast('更新状态失败', 'error')
      else {
        onSuccess()
        onClose()
      }
    } finally {
      setIsProcessing(false)
    }
  }

  if (!order) return null

  const idx = STATUS_FLOW.indexOf(order.status)
  const nextStatus = STATUS_FLOW[idx + 1]

  return (
    <>
      <Dialog open={!!order} onOpenChange={(open) => !open && onClose()}>
        <DialogContent 
          initialFocus={false}
          className="sm:max-w-[550px] w-[95vw] max-h-[90vh] flex flex-col p-0 overflow-hidden gap-0 border-none shadow-2xl rounded-2xl bg-white ring-1 ring-black/5 font-sans"
        >
          {/* Header */}
          <DialogHeader className="px-5 py-3 border-b flex-shrink-0 bg-white sticky top-0 z-10">
            <div className="flex items-center gap-3">
              <DialogTitle className="text-lg font-black text-slate-800 tracking-tight">订单详情</DialogTitle>
              <Badge variant="outline" className={cn("px-2.5 py-0.5 font-black text-[10px] tracking-wide uppercase border-2", STATUS_COLORS[order.status])}>
                {STATUS_LABELS[order.status]}
              </Badge>
            </div>
          </DialogHeader>

          {/* Body */}
          <div 
            ref={modalBodyRef}
            className="flex-1 overflow-y-auto bg-slate-50/40 custom-scrollbar p-0"
          >
            <div className="p-6 space-y-6">
              <AfterSalesStatusCard 
                order={order} 
                orderItems={orderItems} 
                usedCoupons={usedCoupons} 
                onHandleRefund={async () => {
                  const res = calculateCancellationPenalty(order)
                  const penaltyAmt = Number(order.total_amount) * res.rate
                  const finalAmt = Math.max(0, Number(order.total_amount) - penaltyAmt)

                  const msg = `商家已收到您的售后申请。按规定当前退单需扣除违约金 ${formatPrice(penaltyAmt)} (${res.reason})，实退金额约为 ${formatPrice(finalAmt)}，不过您可以与我协商调整。`
                  await handleSendMessage(msg)

                  setSuggestedRefund({ rate: res.rate, amount: penaltyAmt, final: finalAmt, reason: res.reason })
                  setRefundInput(finalAmt.toString())
                  setRefundMode('fixed')
                  setShowRefundPanel(true)
                }}
              />

              <OrderDetailsCard order={order} orderItems={orderItems} usedCoupons={usedCoupons} />

              {/* 沟通记录区域：待接单隐藏；已取消且无消息时隐藏；已取消且有消息时仅显示历史 */}
              {order.status !== 'pending' && (order.status !== 'cancelled' || messages.length > 0) && (
                <Card className="border-none shadow-sm overflow-hidden bg-white ring-1 ring-black/5 py-0">
                  <div className="px-5 py-3 border-b bg-slate-50/80 flex items-center gap-2 text-xs font-bold text-slate-500">
                    <MessageSquare size={14} className="text-orange-500" /> 沟通与协商记录
                    {order.status === 'cancelled' && <Badge variant="outline" className="ml-auto text-[10px] py-0 h-5">已结束</Badge>}
                  </div>
                  <ChatView
                    messages={messages}
                    currentUserRole="merchant"
                    value={asMsgText}
                    onChange={setAsMsgText}
                    onSend={() => handleSendMessage()}
                    sending={sendingAsMsg}
                    placeholder="发送消息..."
                    scrollAreaClassName="h-[240px]"
                    showInput={order.status !== 'cancelled'}
                    scrollContainerRef={modalBodyRef}
                  />
                </Card>
              )}
            </div>
          </div>

          {!['completed', 'cancelled'].includes(order.status) && (
            <div className="px-6 py-4 border-t bg-white flex gap-3 flex-shrink-0 pb-safe shadow-[0_-4px_12px_rgba(0,0,0,0.02)]">
              <Button variant="outline" className="flex-1 text-red-500 hover:bg-red-50 border-slate-200 font-bold h-11" onClick={() => setShowCancel(true)}>
                取消订单
              </Button>
              <Button 
                className="flex-[2] h-11 bg-orange-500 hover:bg-orange-600 shadow-orange-200 shadow-lg font-black text-base"
                disabled={order.after_sales_status === 'pending'}
                onClick={() => setIsConfirmingStatus(true)}
              >
                {order.after_sales_status === 'pending' ? '请先处理售后' : (STATUS_LABELS[nextStatus] || '完成订单')}
                {order.after_sales_status !== 'pending' && <ChevronRight size={18} className="ml-1" />}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <RefundConsoleDialog 
        open={showRefundPanel}
        onOpenChange={setShowRefundPanel}
        order={order}
        suggestedRefund={suggestedRefund}
        refundMode={refundMode}
        setRefundMode={setRefundMode}
        refundInput={refundInput}
        setRefundInput={setRefundInput}
        orderItems={orderItems}
        selectedRefundItems={selectedRefundItems}
        setSelectedRefundItems={setSelectedRefundItems}
        usedCoupons={usedCoupons}
        selectedCouponRefundIds={selectedCouponRefundIds}
        setSelectedCouponRefundIds={setSelectedCouponRefundIds}
        onReject={() => setShowRejectConfirm(true)}
        onConfirm={requestRefundConfirm}
        currentRefundTotal={currentRefundTotal}
        isProcessing={isProcessing}
      />

      <AlertDialog open={showCancel} onOpenChange={setShowCancel}>
        <AlertDialogContent className="rounded-2xl border-none shadow-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600 text-xl font-black">
              <AlertTriangle className="size-6" /> 确认取消订单？
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-600 font-medium leading-relaxed">
              商家取消订单将触发 <span className="text-red-600 font-bold">全额退款</span>。系统将自动回退客户已使用的积分和优惠券。此操作为高危行为，不可逆转，请慎重考虑。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-3 sm:gap-0 font-bold">
            <AlertDialogCancel className="rounded-xl h-11 border-slate-200" disabled={isProcessing}>再想想</AlertDialogCancel>
            <AlertDialogAction onClick={cancelOrder} disabled={isProcessing} className="rounded-xl h-11 bg-red-600 hover:bg-red-700 shadow-lg shadow-red-100">确认极速取消</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isConfirmingStatus} onOpenChange={setIsConfirmingStatus}>
        <AlertDialogContent className="sm:max-w-md rounded-3xl border-none shadow-2xl overflow-hidden p-0">
          <div className="bg-slate-50 p-8 flex flex-col items-center gap-6">
            <div className="size-16 rounded-full bg-white shadow-sm flex items-center justify-center ring-8 ring-orange-50/50 scale-110">
               <AlertTriangle className="text-orange-500 scale-125" />
            </div>
            <div className="space-y-2 text-center">
              <AlertDialogTitle className="text-2xl font-black tracking-tighter">确认变更订单状态？</AlertDialogTitle>
              <AlertDialogDescription className="text-slate-500 font-medium">变更后将无法回退到上一个状态</AlertDialogDescription>
            </div>
            <div className="flex items-center gap-4 py-3 px-8 bg-white rounded-3xl shadow-sm ring-1 ring-slate-100">
               <Badge variant="secondary" className="px-4 py-1 text-sm bg-slate-100 text-slate-500 border-none font-bold">{STATUS_LABELS[order.status]}</Badge>
               <ChevronRight className="text-orange-400 size-5 animate-pulse" />
               <Badge className="px-4 py-1 text-sm bg-orange-500 text-white border-none font-black shadow-md shadow-orange-100">{STATUS_LABELS[nextStatus]}</Badge>
            </div>
          </div>
          <div className="p-6 bg-white grid grid-cols-2 gap-4">
            <AlertDialogCancel className="rounded-2xl h-12 border-slate-100 font-bold hover:bg-slate-50 transition-all" disabled={isProcessing}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={updateStatus} disabled={isProcessing} className="rounded-2xl h-12 bg-orange-500 hover:bg-orange-600 font-black shadow-lg shadow-orange-100 text-base transition-all">确认更新</AlertDialogAction>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showRefundConfirm} onOpenChange={setShowRefundConfirm}>
        <AlertDialogContent className="rounded-2xl border-none shadow-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-orange-600 text-xl font-black">
              <AlertTriangle className="size-6" /> 确认退款
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-600 font-medium leading-relaxed">
              确认同意售后？将会退款 <span className="text-orange-600 font-bold">{formatPrice(currentRefundTotal())}</span> 给客户。此操作不可逆转。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-3 sm:gap-0 font-bold">
            <AlertDialogCancel className="rounded-xl h-11 border-slate-200" disabled={isProcessing}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmRefund} disabled={isProcessing} className="rounded-xl h-11 bg-orange-500 hover:bg-orange-600 shadow-lg shadow-orange-100">{isProcessing ? '处理中...' : '确认退款'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={showRejectConfirm} onOpenChange={setShowRejectConfirm}>
        <AlertDialogContent className="rounded-2xl border-none shadow-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-red-600 text-xl font-black">
              <AlertTriangle className="size-6" /> 确认驳回售后
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-600 font-medium leading-relaxed">
              确定要驳回这笔售后申请吗？驳回后客户仍可通过留言继续沟通。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-3 sm:gap-0 font-bold">
            <AlertDialogCancel className="rounded-xl h-11 border-slate-200" disabled={isProcessing}>取消</AlertDialogCancel>
            <AlertDialogAction onClick={handleRejectRefund} disabled={isProcessing} className="rounded-xl h-11 bg-red-600 hover:bg-red-700 shadow-lg shadow-red-100">{isProcessing ? '处理中...' : '确认驳回'}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

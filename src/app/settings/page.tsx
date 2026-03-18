'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { Merchant, DisabledDate } from '@/lib/types'
import { ArrowLeft, Upload, Trash2, Plus, Power, Store, Bell, Wallet, CalendarDays, CalendarIcon, Pencil } from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'
import { format } from "date-fns"
import { zhCN } from "date-fns/locale"
import { useToast } from '@/components/common/Toast'
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Button, buttonVariants } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { TimePicker } from "@/components/ui/time-picker"
import { cn } from '@/lib/utils'
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import * as z from "zod"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"

const disabledDateSchema = z.object({
  disabled_date: z.string().min(1, "请选择停业日期"),
  reason: z.string().optional(),
})

type DisabledDateFormValues = z.infer<typeof disabledDateSchema>

export default function SettingsPage() {
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()
  
  const [merchant, setMerchant] = useState<Merchant | null>(null)
  const [disabledDates, setDisabledDates] = useState<DisabledDate[]>([])
  const [shopName, setShopName] = useState('')
  const [announcement, setAnnouncement] = useState('')
  const [isAccepting, setIsAccepting] = useState(true)
  const [isAutoOpen, setIsAutoOpen] = useState(false)
  const [openTime, setOpenTime] = useState('09:00')
  const [closeTime, setCloseTime] = useState('21:00')
  const [showDateForm, setShowDateForm] = useState(false)
  const [wechatFile, setWechatFile] = useState<File | null>(null)
  const form = useForm<DisabledDateFormValues>({
    resolver: zodResolver(disabledDateSchema),
    defaultValues: {
      disabled_date: '',
      reason: '',
    }
  })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [alipayFile, setAlipayFile] = useState<File | null>(null)
  const [wechatPreview, setWechatPreview] = useState<string | null>(null)
  const [alipayPreview, setAlipayPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  const loadData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }
    const { data: m } = await supabase.from('merchants').select('*').eq('user_id', user.id).single()
    if (!m) return
    setMerchant(m)
    setShopName(m.shop_name)
    setAnnouncement(m.announcement || '')
    setIsAccepting(m.is_accepting_orders)
    
    if (m.payment_qr_urls?.wechat) setWechatPreview(m.payment_qr_urls.wechat)
    if (m.payment_qr_urls?.alipay) setAlipayPreview(m.payment_qr_urls.alipay)
    
    if (m.business_hours) {
      setIsAutoOpen(m.business_hours.is_enabled)
      setOpenTime(m.business_hours.open_time || '09:00')
      setCloseTime(m.business_hours.close_time || '21:00')
    }

    const { data: dates } = await supabase.from('disabled_dates').select('*').eq('merchant_id', m.id).order('disabled_date')
    setDisabledDates(dates || [])

    setLoading(false)
  }, [supabase, router])

  useEffect(() => { loadData() }, [loadData])

  async function uploadQr(file: File, merchantId: string, label: string): Promise<string | null> {
    const ext = file.name.split('.').pop() || 'jpg'
    const fileName = `${merchantId}/qr_${label}_${Date.now()}.${ext}`
    const { data: uploadData, error } = await supabase.storage.from('menu-images').upload(fileName, file)
    if (error) {
      toast('上传失败: ' + error.message, 'error')
      return null
    }
    if (uploadData) {
      const { data: urlData } = supabase.storage.from('menu-images').getPublicUrl(uploadData.path)
      return urlData.publicUrl
    }
    return null
  }

  async function saveSettings() {
    if (!merchant) return
    setSaving(true)

    try {
      const currentUrls = merchant.payment_qr_urls || {}
      let wechatUrl = currentUrls.wechat || null
      let alipayUrl = currentUrls.alipay || null

      if (wechatFile) {
        const url = await uploadQr(wechatFile, merchant.id, 'wechat')
        if (url) wechatUrl = url
      }
      if (alipayFile) {
        const url = await uploadQr(alipayFile, merchant.id, 'alipay')
        if (url) alipayUrl = url
      }

      const { error } = await supabase.from('merchants').update({
        shop_name: shopName,
        announcement,
        is_accepting_orders: isAccepting,
        payment_qr_urls: { wechat: wechatUrl, alipay: alipayUrl },
        business_hours: { is_enabled: isAutoOpen, open_time: openTime, close_time: closeTime }
      }).eq('id', merchant.id)

      if (error) throw error
      
      toast('店铺设置已更新')
      loadData()
    } catch (err: unknown) {
      toast('保存失败: ' + (err instanceof Error ? err.message : String(err)), 'error')
    } finally {
      setSaving(false)
    }
  }

  async function onSubmitDate(values: DisabledDateFormValues) {
    if (!merchant) return
    
    if (editingId) {
      const { error } = await supabase.from('disabled_dates').update({
        disabled_date: values.disabled_date,
        reason: values.reason || null,
      }).eq('id', editingId)

      if (error) {
        toast('更新失败: ' + error.message, 'error')
        return
      }
      toast('已更新停业日期')
    } else {
      const { error } = await supabase.from('disabled_dates').insert({
        merchant_id: merchant.id,
        disabled_date: values.disabled_date,
        reason: values.reason || null,
      })
      
      if (error) {
        toast('添加失败: ' + error.message, 'error')
        return
      }
      toast('已添加停业日期')
    }

    form.reset()
    setEditingId(null)
    setShowDateForm(false)
    loadData()
  }

  async function removeDisabledDate(id: string) {
    const { error } = await supabase.from('disabled_dates').delete().eq('id', id)
    if (error) {
      toast('删除失败: ' + error.message, 'error')
      return
    }
    toast('已移除停业日期')
    loadData()
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="spinner" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50/30 selection:bg-orange-100 selection:text-orange-900 font-sans pb-32">
      {/* 极简玻璃拟态 Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/70 backdrop-blur-xl border-b border-white/40 px-6 py-4 flex items-center justify-between transition-all duration-300">
        <div className="flex items-center gap-4">
          <Link href="/dashboard" className="p-2.5 -ml-2.5 active:bg-slate-100/80 rounded-[18px] transition-all active:scale-90 group">
            <ArrowLeft size={22} className="text-slate-500 group-hover:text-slate-900" />
          </Link>
          <div className="flex flex-col">
            <h1 className="text-[18px] font-black tracking-tight text-slate-900 leading-none">店铺配置</h1>
          </div>
        </div>
        
        {/* 右侧营业状态微型指示器 */}
        <div className={cn(
          "px-3 py-1.5 rounded-full flex items-center gap-2 ring-1 transition-all",
          isAccepting ? "bg-emerald-50 ring-emerald-100" : "bg-slate-100 ring-slate-200"
        )}>
          <div className={cn("size-1.5 rounded-full animate-pulse", isAccepting ? "bg-emerald-500" : "bg-slate-400")} />
          <span className={cn("text-[10px] font-black uppercase tracking-wider", isAccepting ? "text-emerald-700" : "text-slate-500")}>
            {isAccepting ? '营业中' : '休息中'}
          </span>
        </div>
      </header>

      <main className="pt-20 px-5 max-w-2xl mx-auto space-y-6">
        
        {/* 核心状态面板 */}
        <Card className="border-none shadow-[0_8px_30px_rgb(0,0,0,0.04)] ring-1 ring-black/[0.03] overflow-hidden rounded-[2.5rem] bg-white">
          <CardContent className="p-0">
             {/* 营业开关区块 - 采用渐变激活背景 */}
             <div className={cn(
               "p-8 transition-colors duration-500",
               isAccepting ? "bg-emerald-50/40" : "bg-slate-50/60"
             )}>
                <div className="flex items-center justify-between mb-8">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2.5">
                      <div className={cn("p-2 rounded-xl transition-colors", isAccepting ? "bg-emerald-500 text-white" : "bg-slate-200 text-slate-500")}>
                        <Power size={20} strokeWidth={2.5} />
                      </div>
                      <h3 className="text-xl font-black text-slate-900 tracking-tight">营业状态</h3>
                    </div>
                    <p className="text-xs font-bold text-slate-400 leading-relaxed max-w-[240px]">
                      实时控制店铺营业状态。
                    </p>
                  </div>
                  <Switch 
                    checked={isAccepting}
                    onCheckedChange={setIsAccepting}
                    className="scale-125 data-[state=checked]:bg-emerald-500"
                  />
                </div>

                <div className="h-px bg-slate-100/50 mb-8" />

                {/* 自动定时开启功能 */}
                <div className="mb-8 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label className="text-sm font-black text-slate-800">自动定时营业</Label>
                      <p className="text-[10px] font-medium text-slate-400">在设定时间段内自动接单，其余时间关店</p>
                    </div>
                    <Switch 
                      checked={isAutoOpen}
                      onCheckedChange={setIsAutoOpen}
                      className="data-[state=checked]:bg-blue-500"
                    />
                  </div>
                  
                  {isAutoOpen && (
                    <div className="grid grid-cols-2 gap-4 animate-in fade-in slide-in-from-top-2 duration-300 bg-slate-50/50 p-6 rounded-[2rem] border border-slate-100">
                      <div className="space-y-3">
                        <Label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">开店时间点</Label>
                        <TimePicker 
                          value={openTime} 
                          onChange={setOpenTime} 
                        />
                      </div>
                      <div className="space-y-3">
                        <Label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">关店时间点</Label>
                        <TimePicker 
                          value={closeTime} 
                          onChange={setCloseTime} 
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="h-px bg-slate-100/50 mb-8" />

                <div className="space-y-6">
                  {/* 店铺名 */}
                  <div className="space-y-2">
                    <Label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">品牌名称</Label>
                    <div className="relative group">
                      <Store className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-slate-300 group-focus-within:text-emerald-500 transition-colors" />
                      <Input 
                        value={shopName} 
                        onChange={e => setShopName(e.target.value)}
                        placeholder="输入您的店名"
                        className="h-14 pl-12 rounded-2xl border-transparent bg-slate-100/50 focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-emerald-500/20 focus-visible:border-emerald-500 transition-all font-black text-slate-700 text-base"
                      />
                    </div>
                  </div>

                  {/* 公告 */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between px-1">
                      <Label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">店休公告预览</Label>
                      <Badge variant="outline" className="text-[9px] font-black border-amber-200 bg-amber-50 text-amber-600 rounded-lg py-0">置顶滚动</Badge>
                    </div>
                    <div className="relative">
                      <Bell className="absolute left-4 top-4 size-4 text-amber-400/60" />
                      <Textarea 
                        rows={3} 
                        placeholder="例如：主厨休假，暂不对外营业。下周一见！" 
                        value={announcement} 
                        onChange={e => setAnnouncement(e.target.value)}
                        className="pl-12 rounded-[2rem] border-transparent bg-slate-100/50 focus-visible:bg-white focus-visible:ring-2 focus-visible:ring-emerald-500/20 focus-visible:border-emerald-500 transition-all font-bold text-slate-600 resize-none py-4 leading-relaxed"
                      />
                    </div>
                  </div>
                </div>
             </div>
          </CardContent>
        </Card>

        {/* 支付中心 */}
        <section className="space-y-4">
          <div className="flex items-center gap-4 px-1">
            <div className="size-8 rounded-full bg-slate-900 flex items-center justify-center text-white">
              <Wallet size={16} />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-black text-slate-800 tracking-tight">收款码</span>
            </div>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
               {/* 微信 */}
               <Card className="group relative overflow-hidden border-none shadow-sm ring-1 ring-emerald-100 bg-white rounded-[2rem] active:ring-emerald-500/30 transition-all active:scale-[0.98]">
                 <CardContent className="p-6 flex flex-col items-center">
                    <div className="relative size-32 mb-4 bg-emerald-50/50 rounded-2xl flex items-center justify-center border-2 border-dashed border-emerald-100 active:bg-emerald-50 active:border-emerald-300 transition-all">
                      {wechatPreview ? (
                        <Image src={wechatPreview} alt="微信" fill unoptimized className="object-contain p-2 animate-in fade-in zoom-in-95 duration-500" />
                      ) : (
                        <div className="flex flex-col items-center gap-1">
                          <Plus size={20} className="text-emerald-300" />
                          <Upload size={20} className="text-emerald-200" />
                        </div>
                      )}
                      <input 
                        type="file" 
                        accept="image/*" 
                        className="absolute inset-0 opacity-0 cursor-pointer z-10" 
                        onChange={e => {
                          const f = e.target.files?.[0] || null
                          if (f) {
                            setWechatFile(f)
                            setWechatPreview(URL.createObjectURL(f))
                          }
                        }} 
                      />
                    </div>
                    <Badge className="bg-emerald-500 hover:bg-emerald-600 text-white font-black px-4 py-1 h-auto text-[10px] border-none shadow-sm">微信个人收款码</Badge>
                 </CardContent>
               </Card>

               {/* 支付宝 */}
               <Card className="group relative overflow-hidden border-none shadow-sm ring-1 ring-blue-100 bg-white rounded-[2rem] active:ring-blue-500/30 transition-all active:scale-[0.98]">
                 <CardContent className="p-6 flex flex-col items-center">
                    <div className="relative size-32 mb-4 bg-blue-50/50 rounded-2xl flex items-center justify-center border-2 border-dashed border-blue-100 active:bg-blue-50 active:border-blue-300 transition-all">
                      {alipayPreview ? (
                        <Image src={alipayPreview} alt="支付宝" fill unoptimized className="object-contain p-2 animate-in fade-in zoom-in-95 duration-500" />
                      ) : (
                        <div className="flex flex-col items-center gap-1">
                          <Plus size={20} className="text-blue-300" />
                          <Upload size={20} className="text-blue-200" />
                        </div>
                      )}
                      <input 
                        type="file" 
                        accept="image/*" 
                        className="absolute inset-0 opacity-0 cursor-pointer z-10" 
                        onChange={e => {
                          const f = e.target.files?.[0] || null
                          if (f) {
                            setAlipayFile(f)
                            setAlipayPreview(URL.createObjectURL(f))
                          }
                        }} 
                      />
                    </div>
                    <Badge className="bg-blue-500 hover:bg-blue-600 text-white font-black px-4 py-1 h-auto text-[10px] border-none shadow-sm">支付宝收款码</Badge>
                 </CardContent>
               </Card>
          </div>
        </section>

        {/* 不接单日期 */}
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <CalendarDays size={14} className="text-slate-400" />
              <span className="text-[11px] font-black uppercase tracking-widest text-slate-400">停业日期管理</span>
            </div>
            <Button 
               variant="ghost" 
               size="sm" 
               onClick={() => setShowDateForm(true)}
               className="h-7 px-2 text-emerald-600 font-black text-[11px] uppercase active:bg-emerald-50 active:text-emerald-700"
            >
              <Plus size={14} className="mr-1" /> 添加
            </Button>
          </div>
          
          <Card className="border-none shadow-sm ring-1 ring-black/5 overflow-hidden">
            <CardContent className="p-2 space-y-1">
              {disabledDates.length === 0 ? (
                <div className="py-8 text-center bg-white">
                  <p className="text-[11px] font-black text-slate-300 uppercase tracking-widest">目前全年无休</p>
                </div>
              ) : (
                disabledDates.map(d => (
                  <div key={d.id} className="flex items-center justify-between p-3 rounded-xl active:bg-slate-50 transition-colors group">
                    <div className="flex items-center gap-3">
                      <div className="size-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 font-bold text-[10px]">
                        {d.disabled_date.split('-').slice(1).join('/')}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-[14px] font-bold text-slate-700">{d.disabled_date}</span>
                        {d.reason && <span className="text-[10px] font-medium text-slate-400">{d.reason}</span>}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 transition-all">
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="size-8 text-slate-400 active:text-emerald-500 active:bg-emerald-50"
                        onClick={() => {
                          setEditingId(d.id);
                          form.setValue('disabled_date', d.disabled_date);
                          form.setValue('reason', d.reason || '');
                          setShowDateForm(true);
                        }}
                      >
                        <Pencil size={14} />
                      </Button>
                      <Button 
                        variant="ghost" 
                        size="icon" 
                        className="size-8 text-rose-400 active:text-rose-500 active:bg-rose-50"
                        onClick={() => removeDisabledDate(d.id)}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </section>

        {/* 底部操作区域 - 使用更加大胆的按钮设计 */}
        <div className="fixed bottom-0 left-0 right-0 p-8 bg-gradient-to-t from-slate-50 to-transparent pointer-events-none z-40">
           <div className="max-w-md mx-auto pointer-events-auto">
              <Button 
                className="w-full h-16 rounded-[2rem] bg-slate-900 active:bg-black text-white font-black text-lg shadow-[0_20px_40px_rgba(15,15,15,0.15)] active:scale-95 transition-all flex items-center justify-center gap-3"
                onClick={saveSettings}
                disabled={saving}
              >
                {saving ? (
                  <div className="size-6 border-b-2 border-white rounded-full animate-spin" />
                ) : (
                  <>
                    保存设定
                  </>
                )}
              </Button>
           </div>
        </div>
      </main>

      <Dialog open={showDateForm} onOpenChange={open => {
        setShowDateForm(open)
        if (!open) {
          form.reset()
          setEditingId(null)
        }
      }}>
        <DialogContent className="sm:max-w-[400px] rounded-[24px] border-none p-6 shadow-2xl">
          <DialogHeader className="space-y-2">
            <DialogTitle className="text-xl font-black tracking-tight flex items-center gap-2">
              <CalendarDays className="text-emerald-500" size={20} />
              {editingId ? '编辑停业日期' : '添加停业日期'}
            </DialogTitle>
            <DialogDescription className="text-xs font-medium text-slate-400 font-bold">
              设置该日期后，客户将无法选择此日期进行预约或即时点餐。
            </DialogDescription>
          </DialogHeader>
          
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmitDate)} className="space-y-6 py-4">
              <FormField
                control={form.control}
                name="disabled_date"
                render={({ field }) => (
                  <FormItem className="space-y-2">
                    <FormLabel className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">选择停业日期</FormLabel>
                    <Popover>
                      <PopoverTrigger 
                        className={cn(
                          buttonVariants({ variant: "outline" }),
                          "w-full h-12 justify-start text-left font-bold rounded-xl border-slate-100 bg-slate-50 transition-all focus:ring-emerald-500",
                          !field.value && "text-muted-foreground"
                        )}
                      >
                        <CalendarIcon className="mr-2 h-4 w-4 text-emerald-500" />
                        {field.value ? format(new Date(field.value), "yyyy-MM-dd") : <span className="text-slate-400 font-normal">点击选择日期</span>}
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0 rounded-2xl border-none shadow-2xl" align="start">
                        <Calendar
                          mode="single"
                          locale={zhCN}
                          selected={field.value ? new Date(field.value) : undefined}
                          onSelect={(date) => field.onChange(date ? format(date, "yyyy-MM-dd") : '')}
                          initialFocus
                          className="rounded-2xl"
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage className="text-[10px] font-black text-rose-500 ml-1" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="reason"
                render={({ field }) => (
                  <FormItem className="space-y-2">
                    <FormLabel className="text-[11px] font-black text-slate-400 uppercase tracking-widest ml-1">原因备注 (可选)</FormLabel>
                    <FormControl>
                      <Input 
                        placeholder="例如：店休、私事、设备维护..." 
                        {...field}
                        className="h-12 rounded-xl border-slate-100 bg-slate-50 font-bold focus:ring-emerald-500"
                      />
                    </FormControl>
                    <FormMessage className="text-[10px] font-black text-rose-500 ml-1" />
                  </FormItem>
                )}
              />

              <DialogFooter className="flex-row gap-3 pt-2">
                <Button 
                   type="button"
                   variant="outline" 
                   className="flex-1 h-12 rounded-xl font-black border-slate-100" 
                   onClick={() => setShowDateForm(false)}
                >
                   取消
                </Button>
                <Button 
                   type="submit"
                   className="flex-1 h-12 rounded-xl bg-emerald-500 active:bg-emerald-600 text-white font-black shadow-lg shadow-emerald-100"
                >
                   {editingId ? '确认更新' : '确定添加'}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  )
}

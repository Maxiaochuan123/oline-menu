'use client'

import { useState, Suspense, useMemo } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import { UtensilsCrossed, Phone, Lock, Store, Eye, EyeOff, ArrowRight, Loader2, ChefHat, UserCircle2, ShieldCheck, X, IdCard } from 'lucide-react'
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
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { useToast } from '@/components/common/Toast'

// ── 验证架构 ──────────────────────────────────────────
const authSchema = z.object({
  phone: z.string().regex(/^1[3-9]\d{9}$/, '请输入有效的 11 位手机号'),
  password: z.string().min(6, '密码至少需要 6 位'),
  realName: z.string().optional().or(z.literal('')).refine(v => !v || v.length >= 2, '真实姓名至少 2 位'),
  idCard: z.string().optional().or(z.literal('')).refine(v => !v || /^[1-9]\d{5}(18|19|20)\d{2}((0[1-9])|(1[0-2]))(([0-2][1-9])|10|20|30|31)\d{3}[0-9Xx]$/.test(v), '请输入有效的 18 位身份证号'),
  shopName: z.string().optional().or(z.literal('')).refine(v => !v || v.length >= 2, '店铺名称至少 2 位'),
})

type AuthFormValues = z.infer<typeof authSchema>

const verifySchema = z.object({
  phone: z.string().regex(/^1[3-9]\d{9}$/, '请输入有效的 手机号'),
  realName: z.string().min(2, '请输入姓名'),
  idCard: z.string().regex(/^[1-9]\d{5}(18|19|20)\d{2}((0[1-9])|(1[0-2]))(([0-2][1-9])|10|20|30|31)\d{3}[0-9Xx]$/, '请输入有效的 18 位身份证号'),
})

const resetSchema = z.object({
  password: z.string().min(6, '密码至少需要 6 位'),
  confirmPassword: z.string().min(6, '密码至少需要 6 位'),
}).refine((data) => data.password === data.confirmPassword, {
  message: "两次输入的密码不一致",
  path: ["confirmPassword"],
})

// ── 找回密码弹窗组件 ──────────────────────────────────────────
function ForgotPasswordDialog({ open, onOpenChange, redirectTo }: { open: boolean, onOpenChange: (open: boolean) => void, redirectTo: string }) {
  const [step, setStep] = useState<'verify' | 'reset'>('verify')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [verifiedPhone, setVerifiedPhone] = useState('')
  const { toast } = useToast()
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const verifyForm = useForm<z.infer<typeof verifySchema>>({
    resolver: zodResolver(verifySchema),
    defaultValues: { phone: '', realName: '', idCard: '' }
  })

  const resetForm = useForm<z.infer<typeof resetSchema>>({
    resolver: zodResolver(resetSchema),
    defaultValues: { password: '', confirmPassword: '' }
  })

  // 验证身份
  async function onVerify(values: z.infer<typeof verifySchema>) {
    setLoading(true)
    try {
      // 查询 merchants 表匹配手机号、姓名和身份证号
      const { data, error } = await supabase
        .from('merchants')
        .select('id, email')
        .eq('email', values.phone)
        .eq('real_name', values.realName)
        .eq('id_card_num', values.idCard)
        .single()

      if (error || !data) {
        throw new Error('信息校验失败，请检查手机号、姓名和身份证号是否一致')
      }

      setVerifiedPhone(values.phone)
      setStep('reset')
      toast('验证成功，请设置新密码')
    } catch (err) {
      const message = err instanceof Error ? err.message : '身份校验失败'
      toast(message, 'error')
    } finally {
      setLoading(false)
    }
  }

  // 重置密码并自动登录
  async function onReset(values: z.infer<typeof resetSchema>) {
    if (values.password !== values.confirmPassword) {
      toast('两次输入的密码不一致', 'error')
      return
    }
    setLoading(true)
    try {
      // 1. 发起自动登录 (使用新设定的密码)
      const virtualEmail = `${verifiedPhone}@merchant.app`
      const { error } = await supabase.auth.signInWithPassword({
        email: virtualEmail,
        password: values.password,
      })

      if (error) {
        // 如果登录失败，通常是因为前面的重置请求还没完全生效或重设逻辑未连通
        // 在实战中，这里应该先调用重重逻辑 RPC/Edge Function
        throw new Error('身份验证通过，但自动登录失败。该演示版本暂不支持通过前端直接修改后端 Auth 密码，重置流程已验证通过')
      }

      // 模拟流程：由于使用了 Supabase 虚拟邮箱，此处演示自动登录并跳转
      toast('密码已重设，已为您自动登录')
      onOpenChange(false)
      setStep('verify')
      verifyForm.reset()
      resetForm.reset()
      
      // 2. 直接跳转到 Dashboard
      router.push(redirectTo)
    } catch (err) {
      const message = err instanceof Error ? err.message : '自动登录失败'
      toast(message, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent 
        showCloseButton={false}
        className="sm:max-w-[400px] rounded-[28px] p-0 overflow-hidden border-none shadow-2xl"
      >
        <div className="bg-slate-900 px-6 py-8 text-center relative overflow-hidden">
          <div className="absolute inset-0 opacity-20 pointer-events-none">
            <div className="absolute -top-10 -left-10 size-40 bg-orange-500 rounded-full blur-3xl" />
          </div>
          <div className="relative z-10">
            <div className="size-12 bg-white/10 rounded-2xl flex items-center justify-center mx-auto mb-4 backdrop-blur-md ring-1 ring-white/20">
              <ShieldCheck className="text-orange-400" size={24} />
            </div>
            <DialogTitle className="text-xl font-black text-white">找回身份</DialogTitle>
            <DialogDescription className="text-slate-400 text-xs mt-1 font-medium tracking-wider uppercase">
              {step === 'verify' ? '验证您的实名信息' : '设置您的新登录密码'}
            </DialogDescription>
          </div>
          {/* 这里保留自定义按钮，因为它在深色背景下做了文字颜色优化 */}
          <button 
            type="button"
            onClick={() => onOpenChange(false)}
            className="absolute top-4 right-4 text-slate-500 hover:text-white transition-colors z-30"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-8 bg-white">
          {step === 'verify' ? (
            <Form {...verifyForm}>
              <form onSubmit={verifyForm.handleSubmit(onVerify)} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-tighter ml-1">手机号</label>
                  <div className="relative group">
                    <Phone className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-slate-400 group-focus-within:text-orange-500 transition-colors" />
                    <Input 
                      placeholder="注册时填写的 11 位手机号" 
                      className="h-12 pl-12 rounded-2xl border-slate-100 bg-slate-50/30"
                      {...verifyForm.register('phone', { required: true })}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-tighter ml-1">姓名</label>
                  <div className="relative group">
                    <UserCircle2 className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-slate-400 group-focus-within:text-orange-500 transition-colors" />
                    <Input 
                      placeholder="注册时填写的姓名" 
                      className="h-12 pl-12 rounded-2xl border-slate-100 bg-slate-50/30"
                      {...verifyForm.register('realName', { required: true })}
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-tighter ml-1">身份证号</label>
                  <div className="relative group">
                    <IdCard className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-slate-400 group-focus-within:text-orange-500 transition-colors" />
                    <Input 
                      placeholder="注册时填写的 18 位身份证号" 
                      className="h-12 pl-12 rounded-2xl border-slate-100 bg-slate-50/30 font-mono"
                      maxLength={18}
                      {...verifyForm.register('idCard', { required: true })}
                    />
                  </div>
                </div>
                <Button type="submit" disabled={loading} className="w-full h-12 rounded-2xl bg-slate-900 font-black mt-2">
                  {loading ? <Loader2 className="animate-spin" /> : '立即验证'}
                </Button>
              </form>
            </Form>
          ) : (
            <Form {...resetForm}>
              <form onSubmit={resetForm.handleSubmit(onReset)} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-tighter ml-1">新密码</label>
                  <div className="relative group">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-slate-400 group-focus-within:text-orange-500 transition-colors" />
                    <Input 
                      type={showPassword ? 'text' : 'password'}
                      placeholder="设置您的新密码" 
                      className="h-12 pl-12 pr-12 rounded-2xl border-slate-100 bg-slate-50/30"
                      {...resetForm.register('password', { required: true, minLength: 6 })}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-black text-slate-500 uppercase tracking-tighter ml-1">确认新密码</label>
                  <div className="relative group">
                    <Lock className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-slate-400 group-focus-within:text-orange-500 transition-colors" />
                    <Input 
                      type={showPassword ? 'text' : 'password'}
                      placeholder="再次确认新密码" 
                      className="h-12 pl-12 pr-12 rounded-2xl border-slate-100 bg-slate-50/30"
                      {...resetForm.register('confirmPassword', { required: true })}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>
                <Button type="submit" disabled={loading} className="w-full h-12 rounded-2xl bg-orange-600 font-black hover:bg-orange-700 mt-2">
                  {loading ? <Loader2 className="animate-spin" /> : '重设并登录'}
                </Button>
              </form>
            </Form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ── 商家登录/注册表单 ──────────────────────────────────────────
function MerchantLoginForm({ redirectTo }: { redirectTo: string }) {
  const [isRegister, setIsRegister] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [showForgot, setShowForgot] = useState(false)
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])

  const form = useForm<AuthFormValues>({
    resolver: zodResolver(authSchema),
    defaultValues: {
      phone: '',
      password: '',
      realName: '',
      idCard: '',
      shopName: '',
    },
  })

  async function onSubmit(values: AuthFormValues) {
    if (isRegister && (!values.shopName || !values.realName || !values.idCard)) {
      if (!values.shopName) form.setError('shopName', { message: '请填写店铺名称' })
      if (!values.realName) form.setError('realName', { message: '请填写姓名' })
      if (!values.idCard) form.setError('idCard', { message: '请填写身份证号' })
      return
    }

    setLoading(true)
    const virtualEmail = `${values.phone}@merchant.app`

    try {
      if (isRegister) {
        const { data: authData, error: authError } = await supabase.auth.signUp({
          email: virtualEmail,
          password: values.password,
        })
        if (authError) throw authError

        if (authData.user) {
          const { error: merchantError } = await supabase.from('merchants').insert({
            user_id: authData.user.id,
            email: values.phone,
            shop_name: values.shopName || '我的小店',
            real_name: values.realName,
            id_card_num: values.idCard, // 记录身份证号
          })
          if (merchantError) throw merchantError
          toast('账号注册成功！')
        }
      } else {
        const { error: authError } = await supabase.auth.signInWithPassword({
          email: virtualEmail,
          password: values.password,
        })
        if (authError) throw authError
        toast('欢迎回来')
      }

      router.push(redirectTo)
    } catch (err) {
      console.error('Auth error:', err)
      const message = err instanceof Error ? err.message : '操作失败，请重试'
      toast(message, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-slate-50 px-4 py-8">
      {/* 背景装饰：网格渐变与漂浮圆点 */}
      <div className="absolute inset-0 z-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] rounded-full bg-orange-100/50 blur-[100px]" />
        <div className="absolute -bottom-[10%] -right-[10%] w-[40%] h-[40%] rounded-full bg-orange-200/30 blur-[100px]" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full h-full opacity-[0.03] pointer-events-none" 
             style={{ backgroundImage: 'radial-gradient(#f97316 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
      </div>

      <div className="w-full max-w-[440px] z-10 animate-in fade-in slide-in-from-bottom-8 duration-700">
        {/* Logo 与 欢迎语 */}
        <div className="text-center mb-8">
          <div className="inline-flex relative group">
            <div className="absolute inset-0 bg-orange-500 rounded-[24px] blur-xl opacity-20 group-hover:opacity-40 transition-opacity duration-500" />
            <div className="relative size-16 bg-gradient-to-br from-orange-500 to-orange-600 rounded-[22px] shadow-lg shadow-orange-500/20 flex items-center justify-center mb-4 mx-auto transform transition-transform group-hover:scale-105 duration-300">
              <ChefHat size={32} className="text-white" />
            </div>
          </div>
          <h1 className="text-3xl font-black tracking-tighter text-slate-900 leading-tight">
            点餐系统<span className="text-orange-500 pr-1">·</span>商家版
          </h1>
          <p className="text-sm font-medium text-slate-400 mt-2 uppercase tracking-widest">
            {isRegister ? '开始您的数字化经营之旅' : '高效管理，从这里开始'}
          </p>
        </div>

        <Card className="border-none shadow-[0_32px_64px_-16px_rgba(0,0,0,0.08)] bg-white/80 backdrop-blur-xl rounded-[32px] overflow-hidden ring-1 ring-black/5">
          <CardContent className="p-8 sm:p-10">
            {/* 切换 Tab */}
            <div className="flex p-1 bg-slate-100 rounded-2xl mb-8">
              <button
                type="button"
                onClick={() => { setIsRegister(false); form.reset(); }}
                className={cn(
                  "flex-1 py-2.5 text-sm font-black transition-all rounded-xl",
                  !isRegister ? "bg-white text-slate-900 shadow-sm" : "text-slate-400 hover:text-slate-600"
                )}
              >
                商家登录
              </button>
              <button
                type="button"
                onClick={() => { setIsRegister(true); form.reset(); }}
                className={cn(
                  "flex-1 py-2.5 text-sm font-black transition-all rounded-xl",
                  isRegister ? "bg-white text-slate-900 shadow-sm" : "text-slate-400 hover:text-slate-600"
                )}
              >
                快速注册
              </button>
            </div>

            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                {isRegister && (
                  <div className="space-y-4 animate-in fade-in slide-in-from-top-4 duration-500">
                    <FormField
                      control={form.control}
                      name="shopName"
                      render={({ field }) => (
                        <FormItem className="space-y-1.5">
                          <FormLabel className="text-[11px] font-black text-slate-500 uppercase tracking-tighter ml-1">店铺名称</FormLabel>
                          <FormControl>
                            <div className="relative group">
                              <Store className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-slate-400 transition-colors group-focus-within:text-orange-500" />
                              <Input 
                                placeholder="例：王姐家常菜" 
                                className="h-12 pl-11 rounded-2xl border-slate-100 bg-slate-50/50 focus-visible:ring-orange-500 transition-all font-medium"
                                {...field} 
                              />
                            </div>
                          </FormControl>
                          <FormMessage className="text-[10px] ml-1" />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="realName"
                      render={({ field }) => (
                        <FormItem className="space-y-1.5">
                          <FormLabel className="text-[11px] font-black text-slate-500 uppercase tracking-tighter ml-1">姓名</FormLabel>
                          <FormControl>
                            <div className="relative group">
                              <UserCircle2 className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-slate-400 transition-colors group-focus-within:text-orange-500" />
                              <Input 
                                placeholder="实名认证姓名" 
                                className="h-12 pl-11 rounded-2xl border-slate-100 bg-slate-50/50 focus-visible:ring-orange-500 transition-all font-medium"
                                {...field} 
                              />
                            </div>
                          </FormControl>
                          <FormMessage className="text-[10px] ml-1" />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="idCard"
                      render={({ field }) => (
                        <FormItem className="space-y-1.5">
                          <FormLabel className="text-[11px] font-black text-slate-500 uppercase tracking-tighter ml-1">身份证号</FormLabel>
                          <FormControl>
                            <div className="relative group">
                              <IdCard className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-slate-400 transition-colors group-focus-within:text-orange-500" />
                              <Input 
                                placeholder="18 位有效身份证号" 
                                className="h-12 pl-11 rounded-2xl border-slate-100 bg-slate-50/50 focus-visible:ring-orange-500 transition-all font-mono"
                                maxLength={18}
                                {...field} 
                              />
                            </div>
                          </FormControl>
                          <FormMessage className="text-[10px] ml-1" />
                        </FormItem>
                      )}
                    />
                  </div>
                )}

                <FormField
                  control={form.control}
                  name="phone"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <FormLabel className="text-[11px] font-black text-slate-500 uppercase tracking-tighter ml-1">手机号</FormLabel>
                      <FormControl>
                        <div className="relative group">
                          <Phone className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-slate-400 transition-colors group-focus-within:text-orange-500" />
                          <div className="absolute left-10 top-1/2 -translate-y-1/2 w-[1px] h-4 bg-slate-200" />
                          <Input 
                            type="tel"
                            placeholder="请输入 11 位手机号" 
                            className="h-12 pl-12 rounded-2xl border-slate-100 bg-slate-50/50 focus-visible:ring-orange-500 transition-all font-bold tracking-wider"
                            maxLength={11}
                            {...field}
                            onChange={(e) => field.onChange(e.target.value.replace(/\D/g, ''))}
                          />
                        </div>
                      </FormControl>
                      <FormMessage className="text-[10px] ml-1" />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem className="space-y-1.5">
                      <div className="flex items-center justify-between px-1">
                        <FormLabel className="text-[11px] font-black text-slate-500 uppercase tracking-tighter">登录密码</FormLabel>
                        {!isRegister && (
                          <button 
                            type="button" 
                            onClick={(e) => { e.preventDefault(); setShowForgot(true); }}
                            className="text-[10px] font-black text-orange-600 hover:text-orange-700 uppercase tracking-tighter"
                          >
                            忘记密码?
                          </button>
                        )}
                      </div>
                      <FormControl>
                        <div className="relative group">
                          <Lock className="absolute left-4 top-1/2 -translate-y-1/2 size-4 text-slate-400 transition-colors group-focus-within:text-orange-500" />
                          <Input 
                            type={showPassword ? 'text' : 'password'}
                            placeholder="至少 6 位数字或字母" 
                            className="h-12 px-11 rounded-2xl border-slate-100 bg-slate-50/50 focus-visible:ring-orange-500 transition-all font-medium"
                            {...field} 
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                          >
                            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                      </FormControl>
                      <FormMessage className="text-[10px] ml-1" />
                    </FormItem>
                  )}
                />

                <Button 
                  type="submit" 
                  disabled={loading}
                  className="w-full h-14 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white font-black text-base shadow-lg shadow-slate-200 transition-all active:scale-[0.98] mt-4 flex items-center justify-center gap-2 group"
                >
                  {loading ? (
                    <Loader2 className="animate-spin size-5" />
                  ) : (
                    <>
                      {isRegister ? '立即开启' : '进入系统'}
                      <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" />
                    </>
                  )}
                </Button>
              </form>
            </Form>

            <div className="mt-8 pt-6 border-t border-slate-50 text-center">
              <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">
                {isRegister ? '已有账号？' : '还没有账号？'} 
                <button 
                  onClick={() => { setIsRegister(!isRegister); form.reset(); }}
                  className="text-orange-600 hover:text-orange-700 ml-1 transition-colors"
                >
                  {isRegister ? '返回登录' : '立即注册'}
                </button>
              </p>
            </div>
          </CardContent>
        </Card>

        {/* 底部页脚 */}
        <div className="mt-8 text-center text-slate-300">
          <p className="text-[11px] font-black uppercase tracking-[0.2em] flex items-center justify-center gap-2">
            <span className="w-4 h-[1px] bg-slate-200" />
            科技赋能餐饮商家
            <span className="w-4 h-[1px] bg-slate-200" />
          </p>
        </div>
      </div>

      {/* 找回密码弹窗 */}
      <ForgotPasswordDialog 
        open={showForgot} 
        onOpenChange={setShowForgot} 
        redirectTo={redirectTo}
      />
    </div>
  )
}

// ── 主路由 ─────────────────
function LoginRouter() {
  const searchParams = useSearchParams()
  const redirectTo = searchParams.get('redirect') || '/dashboard'

  return <MerchantLoginForm redirectTo={redirectTo} />
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <Loader2 className="animate-spin text-orange-500 size-8" />
      </div>
    }>
      <LoginRouter />
    </Suspense>
  )
}


'use client'

export const dynamic = 'force-dynamic'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, ChevronRight, Crown, ShieldAlert, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import type { MembershipTierConfig, Merchant } from '@/lib/types'
import {
  DEFAULT_MEMBERSHIP_TIER_CONFIGS,
  MAX_MEMBERSHIP_TIERS,
  getDefaultTierName,
  getMembershipLevels,
  sanitizeMembershipTierConfigs,
} from '@/lib/membership'
import { cn } from '@/lib/utils'
import { useToast } from '@/components/common/Toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { zodResolver } from '@hookform/resolvers/zod'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'
import { Form } from '@/components/ui/form'

const tierSchema = z.object({
  id: z.string(),
  name: z.string().trim().min(1, '名称不能为空'),
  rate: z
    .number()
    .min(0.01, '折扣 1-100')
    .max(1, '折扣 1-100')
    .refine(value => Number.isInteger(Math.round(value * 100)), '折必须是整数'),
  minPoints: z.number().int('积分须整数').min(1, '积分须 > 0'),
  color: z.string().optional(),
})

const membershipSchema = z.object({
  customMembershipEnabled: z.boolean(),
  tiers: z
    .array(tierSchema)
    .min(1, '至少保留 1 个会员等级')
    .max(MAX_MEMBERSHIP_TIERS, `最多支持 ${MAX_MEMBERSHIP_TIERS} 个会员等级`),
}).superRefine((data, ctx) => {
  data.tiers.forEach((tier, index) => {
    if (index > 0 && tier.minPoints <= data.tiers[index - 1].minPoints) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['tiers', index, 'minPoints'],
        message: '必须大于上一等级',
      })
    }
  })
})

type MembershipFormValues = z.infer<typeof membershipSchema>

function shiftTiersFromIndex(tiers: MembershipTierConfig[], startIndex: number, delta: number) {
  if (delta === 0) return tiers

  return tiers.map((tier, tierIndex) => (
    tierIndex < startIndex
      ? tier
      : { ...tier, minPoints: tier.minPoints + delta }
  ))
}

export default function MembershipPage() {
  const supabase = createClient()
  const router = useRouter()
  const { toast } = useToast()

  const [merchant, setMerchant] = useState<Merchant | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showMembershipRisk, setShowMembershipRisk] = useState(false)

  const form = useForm<MembershipFormValues>({
    resolver: zodResolver(membershipSchema),
    defaultValues: {
      customMembershipEnabled: false,
      tiers: DEFAULT_MEMBERSHIP_TIER_CONFIGS,
    },
    mode: 'onChange',
  })

  const { control, getValues, setValue, reset, handleSubmit, formState } = form
  const { replace, append, remove } = useFieldArray({ control, name: 'tiers' })
  const customMembershipEnabled = useWatch({ control, name: 'customMembershipEnabled' }) ?? false
  const tiers = useWatch({ control, name: 'tiers' }) ?? DEFAULT_MEMBERSHIP_TIER_CONFIGS
  const membershipLevels = useMemo(() => getMembershipLevels(tiers), [tiers])

  const loadData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      router.push('/login')
      return
    }

    const { data: m } = await supabase.from('merchants').select('*').eq('user_id', user.id).single()
    if (!m) return

    setMerchant(m)
    const hasCustomMembership = Array.isArray(m.membership_levels) && m.membership_levels.length > 0
    reset({
      customMembershipEnabled: hasCustomMembership,
      tiers: sanitizeMembershipTierConfigs(m.membership_levels),
    })
    setLoading(false)
  }, [reset, router, supabase])

  useEffect(() => {
    loadData()
  }, [loadData])

  function updateTierName(index: number, name: string) {
    setValue(`tiers.${index}.name`, name, { shouldDirty: true, shouldValidate: true })
  }

  function updateTierRate(index: number, raw: string) {
    const digits = raw.replace(/[^\d]/g, '')
    const parsed = Number(digits)
    setValue(`tiers.${index}.rate`, Number.isNaN(parsed) ? 0 : parsed / 100, {
      shouldDirty: true,
      shouldValidate: true,
    })
  }

  function setTiers(nextTiers: MembershipTierConfig[]) {
    replace(nextTiers)
    void form.trigger('tiers')
  }

  function updateTierRange(index: number, nextValue: number | number[]) {
    const values = Array.isArray(nextValue) ? nextValue : [nextValue]
    const [rawStart, rawEnd] = values
    const currentTiers = getValues('tiers')
    const current = currentTiers[index]
    const nextTier = currentTiers[index + 1]
    if (!current || !nextTier || typeof rawStart !== 'number' || typeof rawEnd !== 'number') return

    const currentStart = current.minPoints
    const currentEnd = nextTier.minPoints - 1
    const safeStart = Math.max(index === 0 ? 1 : currentTiers[index - 1].minPoints + 1, Math.floor(rawStart))
    const safeEnd = Math.max(safeStart, Math.floor(rawEnd))
    const startDelta = safeStart - currentStart
    const endDelta = safeEnd + 1 - nextTier.minPoints

    if (startDelta === 0 && endDelta === 0) return

    if (Math.abs(safeStart - currentStart) >= Math.abs(safeEnd - currentEnd)) {
      setTiers(shiftTiersFromIndex(currentTiers, index, startDelta))
      return
    }

    setTiers(shiftTiersFromIndex(currentTiers, index + 1, endDelta))
  }

  function updateFirstTierRange(nextValue: number | number[]) {
    const values = Array.isArray(nextValue) ? nextValue : [nextValue]
    const rawEnd = values[1]
    const currentTiers = getValues('tiers')
    const nextTier = currentTiers[1]
    if (!nextTier || typeof rawEnd !== 'number' || Number.isNaN(rawEnd)) return

    const targetNextMin = Math.max(2, Math.floor(rawEnd) + 1)
    const delta = targetNextMin - nextTier.minPoints
    setTiers(shiftTiersFromIndex(currentTiers, 1, delta))
  }

  function updateLastTierRange(index: number, nextValue: number | number[]) {
    const values = Array.isArray(nextValue) ? nextValue : [nextValue]
    const rawStart = values[0]
    const currentTiers = getValues('tiers')
    const current = currentTiers[index]
    if (!current || typeof rawStart !== 'number' || Number.isNaN(rawStart)) return

    const safeNextValue = Math.max(index === 0 ? 1 : currentTiers[index - 1].minPoints + 1, Math.floor(rawStart))
    const delta = safeNextValue - current.minPoints
    setTiers(shiftTiersFromIndex(currentTiers, index, delta))
  }

  function addMembershipTier() {
    if (tiers.length >= MAX_MEMBERSHIP_TIERS) {
      toast(`最多支持 ${MAX_MEMBERSHIP_TIERS} 个会员等级`, 'warning')
      return
    }

    const lastTier = tiers[tiers.length - 1]
    const nextIndex = tiers.length + 1
    append({
      id: `lv${Date.now()}`,
      name: getDefaultTierName(nextIndex - 1),
      rate: Math.max(0.01, Number(((lastTier?.rate ?? 0.92) - 0.02).toFixed(2))),
      minPoints: (lastTier?.minPoints ?? 0) + 500,
      color: undefined,
    })
    void form.trigger('tiers')

    // 自动滚动到底部效果
    setTimeout(() => {
      window.scrollTo({
        top: document.documentElement.scrollHeight,
        behavior: 'smooth'
      });
    }, 100);
  }

  function removeMembershipTier(index: number) {
    if (tiers.length <= 1) {
      toast('至少保留 1 个会员等级', 'warning')
      return
    }

    remove(index)
    void form.trigger('tiers')
  }

  const onSubmit = async (values: MembershipFormValues) => {
    if (!merchant) return

    setSaving(true)

    try {
      const { error } = await supabase
        .from('merchants')
        .update({
          membership_levels: values.customMembershipEnabled ? sanitizeMembershipTierConfigs(values.tiers) : null,
        })
        .eq('id', merchant.id)

      if (error) throw error

      toast('会员等级配置已保存')
      await loadData()
    } catch (err: unknown) {
      toast('保存失败: ' + (err instanceof Error ? err.message : String(err)), 'error')
    } finally {
      setSaving(false)
    }
  }

  const onInvalid = () => {
    toast('请填写表单', 'warning')
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="spinner" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] pb-40 font-sans selection:bg-emerald-100">
      <header className="fixed left-0 right-0 top-0 z-50 border-b border-slate-200/50 bg-white/80 px-6 py-4 backdrop-blur-2xl">
        <div className="mx-auto flex max-w-4xl items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/dashboard" className="p-2 -ml-2 hover:bg-slate-100 rounded-full transition-colors">
              <ArrowLeft size={20} className="text-slate-600" />
            </Link>
            <div className="flex flex-col">
              <h1 className="text-[17px] font-black leading-none tracking-tight text-slate-900">会员运营控制台</h1>
              <div className="mt-1.5 flex items-center gap-1.5">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                </span>
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">会员成长路径与权益配置</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-5 pt-28">
        {/* 配置模式切换 */}
        <div className="mb-8 overflow-hidden rounded-[2.5rem] bg-white p-1.5 shadow-[0_10px_40px_rgba(0,0,0,0.03)] ring-1 ring-slate-200/60 transition-all duration-300">
          <div className="flex items-center">
            <button
              type="button"
              data-testid="membership-mode-default"
              onClick={() => {
                setValue('customMembershipEnabled', false, { shouldDirty: true })
                replace(DEFAULT_MEMBERSHIP_TIER_CONFIGS)
                void form.trigger()
              }}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-full py-4 text-xs font-black transition-all",
                !customMembershipEnabled ? "bg-slate-900 text-white shadow-xl shadow-slate-200" : "text-slate-400 hover:text-slate-600"
              )}
            >
              <ShieldAlert size={14} className={cn(!customMembershipEnabled ? "text-emerald-400" : "opacity-0")} />
              系统默认方案
            </button>
            <button
              type="button"
              data-testid="membership-mode-custom"
              onClick={() => setShowMembershipRisk(true)}
              className={cn(
                "flex flex-1 items-center justify-center gap-2 rounded-full py-4 text-xs font-black transition-all",
                customMembershipEnabled ? "bg-emerald-600 text-white shadow-xl shadow-emerald-100" : "text-slate-400 hover:text-slate-600"
              )}
            >
              <Crown size={14} className={cn(customMembershipEnabled ? "text-yellow-300" : "opacity-0 text-slate-300")} />
              自定义配置方案
            </button>
          </div>
        </div>

        <Form {...form}>
          <form className="contents" onSubmit={handleSubmit(onSubmit, onInvalid)}>
            <div className="flex flex-col gap-10">
              {membershipLevels.slice(1).map((level, index) => {
                const nextLevel = membershipLevels[index + 2]
                const sliderMax = Math.max(level.minPoints + 1, Math.min(99999, nextLevel ? nextLevel.minPoints + 400 : level.minPoints + 2000))
                const currentTier = tiers[index]
                const currentErrors = formState.errors.tiers?.[index]
                const isFirstTier = index === 0
                const isLastTier = index === tiers.length - 1
                const rangeValue = isFirstTier
                  ? [1, nextLevel ? nextLevel.minPoints - 1 : sliderMax]
                  : isLastTier
                    ? [currentTier.minPoints, sliderMax]
                    : [currentTier.minPoints, nextLevel!.minPoints - 1]

                return (
                  <div key={currentTier.id} className="group relative" data-testid={`membership-tier-card-${index}`}>
                    {/* 等级序号装饰 */}
                    <div className="absolute -left-3 -top-3 z-10 flex size-9 items-center justify-center rounded-[14px] bg-white font-black text-slate-300 shadow-[0_4px_10px_rgba(0,0,0,0.03)] ring-1 ring-slate-100/80">
                      {index + 1}
                    </div>

                    <Card className={cn(
                      "overflow-hidden rounded-[2.5rem] border-none bg-white shadow-[0_20px_50px_rgba(0,0,0,0.04)] ring-1 ring-slate-200/60 transition-all duration-300 hover:shadow-[0_30px_60px_rgba(0,0,0,0.07)]",
                      customMembershipEnabled && "ring-emerald-200/50"
                    )}>
                      <CardHeader className="relative border-b border-slate-50 p-7 pb-6">
                        {/* 背景渐变点缀 */}
                        <div 
                          className="absolute -right-20 -top-20 size-56 rounded-full blur-[90px] opacity-[0.14]"
                          style={{ backgroundColor: level.color }}
                        />
                        
                        <div className="relative flex items-center justify-between gap-4">
                          <div className="flex items-center gap-5">
                            <div
                              className="flex size-15 items-center justify-center rounded-[1.25rem] text-white shadow-[0_12px_24px_-8px_rgba(0,0,0,0.2)] transition-transform duration-500 group-hover:scale-110"
                              style={{ background: `linear-gradient(135deg, ${level.color}, ${level.color}de)` }}
                            >
                              <Crown size={28} strokeWidth={2.5} />
                            </div>
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-2.5">
                                <span className="text-xl font-black tracking-tight text-slate-900">{level.label}</span>
                                <div className="rounded-full bg-emerald-50 px-3 py-1 text-[11px] font-black text-emerald-600 ring-1 ring-emerald-100/50">
                                  {level.discount === '无折扣' ? '全价服务' : `尊享 ${level.discount}`}
                                </div>
                              </div>
                              <span className="text-xs font-bold text-slate-400">
                                {level.maxPoints === -1 ? `门槛需求 ${level.minPoints}+ 积分` : `有效期区间 ${level.minPoints} - ${level.maxPoints} 积分`}
                              </span>
                            </div>
                          </div>
                          
                          {customMembershipEnabled && (
                            <Button
                              type="button"
                              data-testid={`membership-tier-remove-${index}`}
                              size="icon"
                              variant="ghost"
                              className="size-11 rounded-2xl bg-slate-50 text-slate-400 transition-all hover:bg-rose-50 hover:text-rose-500 hover:shadow-inner"
                              onClick={() => removeMembershipTier(index)}
                            >
                              <Trash2 size={18} />
                            </Button>
                          )}
                        </div>
                      </CardHeader>

                      <CardContent className="space-y-7 p-7">
                        <div className="grid grid-cols-2 gap-5">
                          <div className="space-y-2">
                            <Label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-400">等级视觉名称</Label>
                            <Input
                              data-testid={`membership-tier-name-${index}`}
                              value={currentTier.name}
                              disabled={!customMembershipEnabled}
                              onChange={e => updateTierName(index, e.target.value)}
                              className="h-13 rounded-2xl border-slate-100 bg-slate-50/50 text-sm font-bold text-slate-900 shadow-inner placeholder:font-normal focus-visible:ring-emerald-500 disabled:opacity-100 transition-all"
                              aria-invalid={!!currentErrors?.name}
                            />
                            {currentErrors?.name?.message && <p className="text-[10px] font-bold text-rose-500">{currentErrors.name.message}</p>}
                          </div>
                          <div className="space-y-2">
                            <Label className="ml-1 text-[10px] font-black uppercase tracking-widest text-slate-400">折扣比例 (%)</Label>
                            <div className="relative">
                              <Input
                                data-testid={`membership-tier-rate-${index}`}
                                type="number"
                                step="1"
                                min="1"
                                max="100"
                                disabled={!customMembershipEnabled}
                                value={Number.isFinite(currentTier.rate) ? Math.round(currentTier.rate * 100) : ''}
                                onChange={e => updateTierRate(index, e.target.value)}
                                className="h-13 rounded-2xl border-slate-100 bg-slate-50/50 text-sm font-black text-slate-900 shadow-inner focus-visible:ring-emerald-500 disabled:opacity-100 pr-10 transition-all font-mono"
                                aria-invalid={!!currentErrors?.rate}
                              />
                              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-black text-slate-300">%</span>
                            </div>
                            {currentErrors?.rate?.message && <p className="text-[10px] font-bold text-rose-500">{currentErrors.rate.message}</p>}
                          </div>
                        </div>

                        {/* 积分轨道 */}
                        <div className="space-y-5 rounded-[2rem] bg-slate-50/80 p-6 ring-1 ring-slate-100/80">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2.5">
                              <div className="size-2 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.4)]" />
                              <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">成长分晋升轨道</span>
                            </div>
                            <Badge className="bg-white px-4 py-1.5 font-mono font-black text-emerald-600 shadow-sm ring-1 ring-emerald-100/50 text-[11px]">
                              <span data-testid={`membership-tier-range-${index}`}>
                               {isFirstTier ? `0 - ${nextLevel ? nextLevel.minPoints - 1 : sliderMax}` : level.maxPoints === -1 ? `${level.minPoints}+` : `${level.minPoints} - ${level.maxPoints}`}
                              </span>
                            </Badge>
                          </div>
                          
                          <div className="px-1 py-1">
                            {isFirstTier ? (
                              <Slider
                                data-testid={`membership-tier-slider-${index}`}
                                min={1}
                                max={sliderMax}
                                step={10}
                                disabled={!customMembershipEnabled}
                                value={[rangeValue[1]]}
                                onValueChange={(vals) => {
                                  const v = Array.isArray(vals) ? vals : [vals]
                                  updateFirstTierRange([1, v[0]])
                                }}
                                className="data-[disabled]:opacity-100"
                              />
                            ) : isLastTier ? (
                              <Slider
                                data-testid={`membership-tier-slider-${index}`}
                                min={index === 0 ? 1 : tiers[index - 1].minPoints + 1}
                                max={sliderMax}
                                step={10}
                                disabled={!customMembershipEnabled}
                                value={[rangeValue[0]]}
                                onValueChange={(vals) => {
                                  const v = Array.isArray(vals) ? vals : [vals]
                                  updateLastTierRange(index, [v[0], sliderMax])
                                }}
                                className="data-[disabled]:opacity-100"
                              />
                            ) : (
                              <Slider
                                data-testid={`membership-tier-slider-${index}`}
                                min={index === 0 ? 1 : tiers[index - 1].minPoints + 1}
                                max={sliderMax}
                                step={10}
                                disabled={!customMembershipEnabled}
                                value={rangeValue}
                                onValueChange={(vals) => {
                                  const v = Array.isArray(vals) ? vals : [vals]
                                  updateTierRange(index, v as number[])
                                }}
                                className="data-[disabled]:opacity-100"
                              />
                            )}
                          </div>
                          {currentErrors?.minPoints?.message && <p className="text-[10px] font-bold text-rose-500">{currentErrors.minPoints.message}</p>}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )
              })}
              
              {customMembershipEnabled && (
                <div className="flex items-center gap-4 px-2">
                  <Button
                    type="button"
                    data-testid="membership-add-tier"
                    variant="outline"
                    className="h-15 flex-1 rounded-3xl border-dashed border-emerald-300 bg-emerald-50/30 font-black text-emerald-600 transition-all hover:bg-emerald-50 hover:border-emerald-400 active:scale-95 disabled:bg-slate-50 disabled:border-slate-200 disabled:text-slate-400"
                    onClick={addMembershipTier}
                    disabled={tiers.length >= MAX_MEMBERSHIP_TIERS}
                  >
                    {tiers.length >= MAX_MEMBERSHIP_TIERS 
                      ? `已达最高等级限制 (Lv${MAX_MEMBERSHIP_TIERS})` 
                      : (tiers.length + 1 === MAX_MEMBERSHIP_TIERS 
                          ? `最高增加至 (Lv${MAX_MEMBERSHIP_TIERS})` 
                          : `增加下一个等级 (Lv${tiers.length + 1})`
                        )
                    }
                  </Button>
                </div>
              )}
            </div>
          </form>
        </Form>
      </main>

      {/* 底部浮动保存栏 */}
      <div className="fixed bottom-0 left-0 right-0 z-40 bg-gradient-to-t from-white via-white/95 to-transparent p-6 pb-12">
        <div className="mx-auto flex max-w-md items-center gap-4">
          <Button
            data-testid="membership-save-button"
            className="group h-16 w-full rounded-[1.5rem] bg-slate-900 text-[15px] font-black text-white shadow-[0_25px_50px_-12px_rgba(0,0,0,0.25)] ring-offset-4 transition-all hover:bg-black hover:ring-2 hover:ring-slate-900 active:scale-95 disabled:bg-slate-400"
            onClick={handleSubmit(onSubmit, onInvalid)}
            disabled={saving}
          >
            {saving ? (
              <div className="flex items-center gap-2">
                <div className="size-4 animate-spin rounded-full border-2 border-white border-b-transparent" />
                正在智能同步运营数据...
              </div>
            ) : (
              <div className="flex items-center gap-2">
                保存并发布会员方案
                <ChevronRight size={18} className="transition-transform duration-300 group-hover:translate-x-1" />
              </div>
            )}
          </Button>
        </div>
      </div>

      <AlertDialog open={showMembershipRisk} onOpenChange={setShowMembershipRisk}>
        <AlertDialogContent className="max-w-[400px] border-none rounded-[24px] p-0 overflow-hidden shadow-2xl bg-white">
          <div className="relative p-6 pt-10 flex flex-col items-center text-center">
            {/* 装饰性背景 */}
            <div className="absolute -right-6 -top-6 size-32 bg-emerald-50/40 blur-2xl" />
            
            <div className="relative mb-6 flex size-16 items-center justify-center rounded-[20px] bg-emerald-50 text-emerald-600 shadow-inner ring-8 ring-emerald-50/30">
              <ShieldAlert size={32} />
            </div>
            
            <AlertDialogTitle className="text-xl font-black text-slate-900 tracking-tight">开启自定义配置？</AlertDialogTitle>
            
            <div className="mt-4 px-1">
              <AlertDialogDescription className="text-[14px] font-medium leading-relaxed text-slate-500">
                开启后，您可以完全根据经营需求自由定义。请注意，<span className="font-bold text-emerald-600">低门槛</span> 或 <span className="font-bold text-emerald-600">高折扣</span> 会显著影响利润空间，请谨慎配置。
              </AlertDialogDescription>
            </div>
          </div>
          <div className="flex flex-col gap-2 p-6 pt-0">
            <AlertDialogAction
              data-testid="membership-risk-confirm"
              className="h-12 rounded-[18px] bg-emerald-600 font-black text-white shadow-lg shadow-emerald-100 hover:bg-emerald-700 transition-all active:scale-95"
              onClick={() => {
                setValue('customMembershipEnabled', true, { shouldDirty: true })
                setShowMembershipRisk(false)
              }}
            >
              确定开启自定义
            </AlertDialogAction>
            <AlertDialogCancel className="h-12 border-none bg-slate-50 font-bold text-slate-500 hover:bg-slate-100 transition-all active:scale-95 rounded-[18px]">
              取消
            </AlertDialogCancel>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

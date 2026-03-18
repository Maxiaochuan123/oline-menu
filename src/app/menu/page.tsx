'use client'

export const dynamic = 'force-dynamic'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import type { Merchant, Category, MenuItem } from '@/lib/types'
import { 
  ArrowLeft, Plus, Pencil, Trash2, FolderOpen, Sparkles, Eye, EyeOff, UtensilsCrossed, 
  LayoutGrid, Image as ImageIcon, Save, Check, CalendarIcon, AlertTriangle, Settings2
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { cn } from '@/lib/utils'

import { z } from "zod"
import { useForm } from "react-hook-form"
import { zodResolver } from "@hookform/resolvers/zod"
import { format } from "date-fns"
import { zhCN } from "date-fns/locale"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { Checkbox } from "@/components/ui/checkbox"
import { useToast } from '@/components/common/Toast'

// --- 表单校验 Schema ---
const itemSchema = z.object({
  name: z.string().min(1, '请输入菜品名称').max(50, '名称过长'),
  description: z.string().max(200, '描述过长'),
  price: z.number().min(0.01, '价格必须大于0'),
  unit: z.string().min(1, '请选择单位'),
  category_id: z.string().min(1, '请选择所属分类'),
  is_new: z.boolean(),
  new_until: z.date().nullable(),
})

type ItemFormValues = {
  name: string
  description: string
  price: number
  unit: string
  category_id: string
  is_new: boolean
  new_until: Date | null
}

export default function MenuPage() {
  const { toast } = useToast()
  const supabase = createClient()
  const router = useRouter()
  const [merchant, setMerchant] = useState<Merchant | null>(null)
  const [categories, setCategories] = useState<Category[]>([])
  const [menuItems, setMenuItems] = useState<MenuItem[]>([])
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  // 弹窗状态
  const [showCategoryForm, setShowCategoryForm] = useState(false)
  const [showItemForm, setShowItemForm] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [editingItem, setEditingItem] = useState<MenuItem | null>(null)

  // 表单状态 (分类等)
  const [catName, setCatName] = useState('')
  const [itemImage, setItemImage] = useState<File | null>(null)
  const [itemImagePreview, setItemImagePreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  
  const [itemToDelete, setItemToDelete] = useState<string | null>(null)
  const [catToDelete, setCatToDelete] = useState<string | null>(null)
  const [usedItemIds, setUsedItemIds] = useState<Set<string>>(new Set())
  const [showCatManager, setShowCatManager] = useState(false)

  const itemForm = useForm<ItemFormValues>({
    resolver: zodResolver(itemSchema),
    defaultValues: {
      name: '',
      description: '',
      price: 0,
      unit: '份',
      category_id: '',
      is_new: true,
      new_until: null,
    }
  })

  const loadData = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { router.push('/login'); return }

    const { data: m } = await supabase.from('merchants').select('*').eq('user_id', user.id).single()
    if (!m) { router.push('/login'); return }
    setMerchant(m)

    const { data: cats } = await supabase.from('categories').select('*').eq('merchant_id', m.id).order('sort_order')
    setCategories(cats || [])
    if (cats && cats.length > 0 && !activeCategory) setActiveCategory(cats[0].id)

    const { data: items } = await supabase.from('menu_items').select('*').eq('merchant_id', m.id).order('created_at', { ascending: false })
    const fetchedItems = items || []
    setMenuItems(fetchedItems)

    // 查询哪些菜品已有订单记录
    if (fetchedItems.length > 0) {
      const { data: usage } = await supabase
        .from('order_items')
        .select('menu_item_id')
        .in('menu_item_id', fetchedItems.map(i => i.id))
      
      const usedSet = new Set<string>((usage || []).map(u => u.menu_item_id))
      setUsedItemIds(usedSet)
    }

    setLoading(false)
  }, [supabase, router, activeCategory])

  useEffect(() => { loadData() }, [loadData])

  // ---- 分类操作 ----
  async function saveCategory() {
    if (!merchant || !catName.trim()) return
    setSaving(true)
    if (editingCategory) {
      await supabase.from('categories').update({ name: catName.trim() }).eq('id', editingCategory.id)
    } else {
      await supabase.from('categories').insert({ merchant_id: merchant.id, name: catName.trim(), sort_order: categories.length })
    }
    setCatName('')
    setEditingCategory(null)
    setShowCategoryForm(false)
    setSaving(false)
    loadData()
  }

  async function deleteCategory(id: string) {
    const hasItems = menuItems.some(item => item.category_id === id)
    if (hasItems) {
      toast('该分类下还包含菜品，请先清理分类下的内容后再尝试删除', 'warning')
      return
    }
    setCatToDelete(id)
  }

  async function confirmDeleteCategory() {
    if (!catToDelete) return
    const { error } = await supabase.from('categories').delete().eq('id', catToDelete)
    if (error) toast('操作失败', 'error')
    else {
      toast('分类已成功移除')
      loadData()
    }
    setCatToDelete(null)
  }

  // ---- 菜品操作 ----
  function openItemForm(item?: MenuItem) {
    if (item) {
      setEditingItem(item)
      itemForm.reset({
        name: item.name,
        description: item.description || '',
        price: item.price as unknown as number,
        unit: item.unit || '个',
        category_id: item.category_id || '',
        is_new: item.is_new,
        new_until: item.new_until ? new Date(item.new_until) : null,
      })
      setItemImagePreview(item.image_url || null)
    } else {
      setEditingItem(null)
      const date = new Date()
      date.setDate(date.getDate() + 7)
      itemForm.reset({
        name: '',
        description: '',
        price: '' as unknown as number,
        unit: '个',
        category_id: '',
        is_new: true,
        new_until: date,
      })
      setItemImagePreview(null)
    }
    setItemImage(null)
    setShowItemForm(true)
  }

  const onInvalid = () => {
    toast('请检查并填写表单中的错误或遗漏项', 'warning')
  }

  async function saveItem(values: ItemFormValues) {
    if (!merchant) return
    let imageUrl = editingItem?.image_url || null
    if (!imageUrl && !itemImage) {
      toast('请上传菜品展示图', 'error')
      return
    }

    setSaving(true)

    if (itemImage) {
      const ext = itemImage.name.split('.').pop() || 'jpg'
      const fileName = `${merchant.id}/${Date.now()}.${ext}`
      const { data: uploadData } = await supabase.storage.from('menu-images').upload(fileName, itemImage)
      if (uploadData) {
        const { data: urlData } = supabase.storage.from('menu-images').getPublicUrl(uploadData.path)
        imageUrl = urlData.publicUrl
      }
    }

    const payload = {
      merchant_id: merchant.id,
      category_id: values.category_id,
      name: values.name.trim(),
      description: values.description?.trim() || null,
      price: values.price,
      unit: values.unit,
      image_url: imageUrl,
      is_new: values.is_new,
      new_until: values.new_until ? values.new_until.toISOString() : null,
    }

    if (editingItem) {
      await supabase.from('menu_items').update(payload).eq('id', editingItem.id)
    } else {
      await supabase.from('menu_items').insert(payload)
    }

    setShowItemForm(false)
    setSaving(false)
    loadData()
  }

  async function toggleItemAvailable(item: MenuItem) {
    await supabase.from('menu_items').update({ is_available: !item.is_available }).eq('id', item.id)
    loadData()
  }

  async function deleteItem(id: string) {
    if (usedItemIds.has(id)) {
      toast('已有订单记录，不允许删除', 'warning')
      return
    }
    setItemToDelete(id)
  }

  async function confirmDeleteItem() {
    if (!itemToDelete) return
    const { error } = await supabase.from('menu_items').delete().eq('id', itemToDelete)
    if (error) toast('删除失败: ' + error.message, 'error')
    else {
      toast('菜品已永久删除')
      loadData()
    }
    setItemToDelete(null)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-50">
        <div className="spinner" />
      </div>
    )
  }

  const filteredItems = activeCategory
    ? menuItems.filter(i => i.category_id === activeCategory)
    : menuItems

  return (
    <div className="min-h-screen bg-slate-50/50 font-sans pb-20 text-slate-900">
      {/* 顶部导航 */}
      <header className="fixed top-0 left-0 right-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-100 flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="p-2 hover:bg-slate-100 rounded-full transition-colors">
            <ArrowLeft size={20} className="text-slate-600" />
          </Link>
          <div className="flex flex-col">
            <h1 className="text-base font-black tracking-tight leading-none">菜单管理</h1>
          </div>
        </div>
        <Button size="sm" onClick={() => openItemForm()} className="bg-orange-500 hover:bg-orange-600 font-black rounded-xl gap-1.5 shadow-lg shadow-orange-100">
          <Plus size={16} strokeWidth={3} />
          添加菜品
        </Button>
      </header>

      {/* 分类快捷导航 */}
      <section className="pt-16 bg-white border-b border-slate-100 sticky top-0 z-30">
        <div className="flex items-center justify-between px-5 pt-3 mb-1">
          <div className="flex items-center gap-1.5 text-slate-400">
            <LayoutGrid size={14} />
            <span className="text-[11px] font-black uppercase tracking-tight">菜品分类</span>
          </div>
          <button 
            onClick={() => setShowCatManager(true)}
            className="text-[11px] font-black text-slate-400 hover:text-orange-500 uppercase tracking-tight flex items-center gap-1.5 py-1 px-2 rounded-lg bg-slate-50 transition-all border border-slate-100/50 active:scale-95"
          >
            <Settings2 size={12} strokeWidth={3} /> 管理
          </button>
        </div>
        
        <ScrollArea className="w-full whitespace-nowrap overflow-hidden">
          <div className="flex p-4 pt-1 gap-2.5">
            <Button
              variant={!activeCategory ? "default" : "ghost"}
              size="sm"
              onClick={() => setActiveCategory(null)}
              className={cn(
                "rounded-full font-bold px-6 h-9 transition-all border-none outline-none focus:ring-0",
                !activeCategory ? "bg-slate-900 text-white shadow-xl shadow-slate-200" : "text-slate-500 hover:bg-slate-50"
              )}
            >
              全部
            </Button>
            {categories.map(cat => (
              <Button
                key={cat.id}
                variant={activeCategory === cat.id ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setActiveCategory(cat.id)}
                className={cn(
                  "rounded-full font-bold px-5 h-9 border border-slate-100 transition-all outline-none focus:ring-0",
                  activeCategory === cat.id ? "bg-orange-50 text-orange-600 border-orange-100 shadow-sm" : "text-slate-500 bg-white"
                )}
              >
                {cat.name}
              </Button>
            ))}
          </div>
          <ScrollBar orientation="horizontal" className="hidden" />
        </ScrollArea>
      </section>

      {/* 菜品列表矩阵 */}
      <main className="px-5 py-6 max-w-2xl mx-auto space-y-4">
        {filteredItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-20 bg-white rounded-[2.5rem] border-2 border-dashed border-slate-100 shadow-sm">
            <div className="size-24 bg-slate-50 rounded-full flex items-center justify-center mb-6 ring-8 ring-slate-50/50">
              <FolderOpen size={48} className="text-slate-200" />
            </div>
            <h3 className="font-black text-slate-900 text-lg">暂无菜品数据</h3>
            <p className="text-xs text-slate-400 font-medium mt-1 uppercase tracking-widest">开启您的美食之旅</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            {filteredItems.map(item => (
              <div 
                key={item.id} 
                className={cn(
                  "group relative bg-white rounded-[2rem] p-4 flex gap-5 transition-all duration-500 hover:shadow-2xl hover:shadow-orange-100/50 hover:-translate-y-1 border border-slate-100",
                  !item.is_available && "opacity-60 saturate-[0.5]"
                )}
              >
                {/* 悬浮装饰背景 */}
                <div className="absolute inset-0 bg-gradient-to-br from-orange-50/0 to-orange-50/0 group-hover:from-orange-50/50 group-hover:to-transparent rounded-[2rem] transition-all duration-500 -z-1" />

                {/* 商品图容器 */}
                <div className="relative size-28 flex-shrink-0">
                  <div className="size-full rounded-3xl overflow-hidden bg-slate-50 ring-4 ring-slate-50 shadow-inner">
                    {item.image_url ? (
                      <Image 
                        src={item.image_url} 
                        alt={item.name} 
                        width={112}
                        height={112}
                        className="size-full object-cover transition-transform duration-700 group-hover:scale-110" 
                        unoptimized
                      />
                    ) : (
                      <div className="size-full flex items-center justify-center text-slate-200">
                        <UtensilsCrossed size={32} />
                      </div>
                    )}
                  </div>
                  
                  {/* 状态徽章 */}
                  {!item.is_available && (
                    <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px] rounded-3xl flex items-center justify-center">
                      <span className="bg-white text-slate-900 font-black text-[10px] px-3 py-1 rounded-full shadow-lg">已下架</span>
                    </div>
                  )}
                  
                  {item.is_new && new Date(item.new_until || '') > new Date() && (
                    <div className="absolute -top-2 -right-2 bg-gradient-to-r from-orange-500 to-amber-400 text-white p-1.5 rounded-xl shadow-lg shadow-orange-200 animate-pulse">
                      <Sparkles size={12} fill="currentColor" />
                    </div>
                  )}
                </div>
                
                {/* 商品详情 */}
                <div className="flex-1 flex flex-col justify-between py-1 min-w-0 relative z-10">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                       <h3 className="font-black text-slate-900 text-lg tracking-tight truncate">{item.name}</h3>
                       <div className="flex items-center gap-1">
                          <button 
                            onClick={() => toggleItemAvailable(item)}
                            className={cn(
                              "size-8 rounded-xl flex items-center justify-center transition-all active:scale-95",
                              item.is_available ? "text-emerald-500 bg-emerald-50 active:bg-emerald-100" : "text-slate-400 bg-slate-50 active:bg-slate-100"
                            )}
                          >
                            {item.is_available ? <Eye size={16} /> : <EyeOff size={16} />}
                          </button>
                          <button 
                            onClick={() => openItemForm(item)}
                            className="size-8 rounded-xl bg-blue-50 text-blue-500 flex items-center justify-center active:bg-blue-100 active:scale-95 transition-all"
                          >
                            <Pencil size={16} />
                          </button>
                           {!usedItemIds.has(item.id) && (
                            <button 
                              onClick={() => deleteItem(item.id)}
                              className="size-8 rounded-xl bg-rose-50 text-rose-500 flex items-center justify-center active:bg-rose-100 active:scale-95 transition-all"
                            >
                              <Trash2 size={16} />
                            </button>
                          )}
                       </div>
                    </div>
                    
                    {item.description && (
                      <p className="text-xs text-slate-400 font-medium line-clamp-2 leading-snug pr-4">
                        {item.description}
                      </p>
                    )}
                  </div>
                  
                  <div className="flex items-end justify-between mt-auto">
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-black text-slate-900 tracking-tighter">
                        <span className="text-sm font-black mr-0.5 text-orange-500">¥</span>
                        {item.price.toFixed(2)}
                      </span>
                      <span className="text-[10px] text-slate-300 font-black uppercase tracking-widest bg-slate-50 px-2 py-0.5 rounded-md">
                        / {item.unit || '个'}
                      </span>
                    </div>

                    <div />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* 分类编辑弹窗 */}
      <Dialog open={showCategoryForm} onOpenChange={setShowCategoryForm}>
        <DialogContent className="sm:max-w-[400px] rounded-3xl p-6">
          <DialogHeader>
            <DialogTitle className="text-xl font-black tracking-tight">
              {editingCategory ? '编辑分类' : '添加新分类'}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Input 
              placeholder="例如：特惠午餐、招牌炒菜..." 
              value={catName} 
              onChange={e => setCatName(e.target.value)}
              className="h-12 text-base font-bold rounded-2xl bg-slate-50 border-none focus-visible:ring-orange-500 transition-all"
            />
          </div>
          <DialogFooter>
            <Button 
              className="w-full h-12 rounded-2xl bg-orange-500 hover:bg-orange-600 font-black shadow-lg shadow-orange-100 gap-2"
              onClick={saveCategory}
              disabled={saving}
            >
              {saving ? <div className="spinner" /> : (
                <>
                  <Check size={18} strokeWidth={3} />
                  保存分类
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 菜品编辑弹窗 */}
      <Dialog open={showItemForm} onOpenChange={setShowItemForm}>
        <DialogContent className="sm:max-w-[425px] rounded-3xl p-6 max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-xl font-black tracking-tight">
              {editingItem ? '编辑菜品详情' : '创建新菜品'}
            </DialogTitle>
          </DialogHeader>
          
          <Form {...itemForm}>
            <form onSubmit={itemForm.handleSubmit(saveItem, onInvalid)} className="space-y-5 py-4">
              {/* 图片上传区域 */}
              <div className="group relative">
                <Label className="text-[11px] font-black uppercase tracking-widest text-slate-400 mb-2 block">菜品展示图</Label>
                <div className="relative aspect-video rounded-3xl overflow-hidden bg-slate-50 border-2 border-dashed border-slate-200 group-hover:border-orange-200 transition-all flex flex-col items-center justify-center gap-3">
                  {itemImagePreview ? (
                    <>
                      <Image 
                        src={itemImagePreview} 
                        alt="Preview" 
                        width={400} 
                        height={225} 
                        className="size-full object-cover" 
                        unoptimized
                      />
                      <div className="absolute inset-0 bg-black/20 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <Button variant="secondary" size="sm" type="button" className="rounded-full font-black">更换图片</Button>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="size-12 bg-white rounded-2xl flex items-center justify-center shadow-sm text-slate-300">
                        <ImageIcon size={24} />
                      </div>
                      <div className="text-center">
                        <p className="text-xs font-black text-slate-500">点击或拖拽上传</p>
                        <p className="text-[10px] text-slate-300 font-medium mt-0.5">支持 JPG, PNG, WEBP</p>
                      </div>
                    </>
                  )}
                  <input 
                    type="file" 
                    accept="image/*" 
                    onChange={e => {
                      const file = e.target.files?.[0] || null
                      setItemImage(file)
                      if (file) setItemImagePreview(URL.createObjectURL(file))
                    }} 
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                </div>
              </div>

              <div className="space-y-4">
                <div className="space-y-2 relative">
                  <Label className="text-[11px] font-black uppercase tracking-widest text-slate-400">基本信息</Label>
                  <FormField
                    control={itemForm.control}
                    name="name"
                    render={({ field }) => (
                      <FormItem className="space-y-0">
                        <FormControl>
                          <Input 
                            placeholder="菜品名称 *" 
                            className="rounded-xl bg-slate-50 border-none font-bold placeholder:font-medium" 
                            {...field} 
                          />
                        </FormControl>
                        <FormMessage className="text-[10px] ml-1 absolute" />
                      </FormItem>
                    )}
                  />
                  <div className="h-1.5" />
                  <FormField
                    control={itemForm.control}
                    name="description"
                    render={({ field }) => (
                      <FormItem className="space-y-0 relative">
                        <FormControl>
                          <Input 
                            placeholder="描述：选填，介绍菜品特色" 
                            className="rounded-xl bg-slate-50 border-none font-bold placeholder:font-medium" 
                            {...field} 
                          />
                        </FormControl>
                        <FormMessage className="text-[10px] ml-1 absolute" />
                      </FormItem>
                    )}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label className="text-[11px] font-black uppercase tracking-widest text-slate-400">价格策略</Label>
                    <div className="flex gap-2 relative">
                      <FormField
                        control={itemForm.control}
                        name="price"
                        render={({ field }) => (
                          <FormItem className="flex-1 space-y-0">
                            <FormControl>
                              <Input 
                                type="number" 
                                step="0.01" 
                                placeholder="价格 *" 
                                className="rounded-xl bg-slate-50 border-none font-black text-orange-500" 
                                {...field} 
                                value={field.value ?? ''}
                              />
                            </FormControl>
                            <FormMessage className="text-[10px] ml-1 mt-1 absolute" />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={itemForm.control}
                        name="unit"
                        render={({ field }) => (
                        <FormItem className="w-20 space-y-0 shrink-0">
                          <Select onValueChange={field.onChange} value={field.value || '个'}>
                            <FormControl>
                              <SelectTrigger className="rounded-xl bg-slate-50 border-none font-black text-xs px-2 focus:ring-2 focus:ring-orange-500 outline-none">
                                <SelectValue placeholder="单位">
                                  {field.value ? `/ ${field.value}` : '单位'}
                                </SelectValue>
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {['个', '份', '碗', '杯', '斤', '盒', '袋'].map(u => (
                                <SelectItem key={u} value={u}>/ {u}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </FormItem>
                        )}
                      />
                    </div>
                  </div>
                  <div className="space-y-2 relative">
                    <Label className="text-[11px] font-black uppercase tracking-widest text-slate-400">所属分类</Label>
                    <FormField
                      control={itemForm.control}
                      name="category_id"
                      render={({ field }) => (
                        <FormItem className="space-y-0">
                          <Select onValueChange={field.onChange} value={field.value || ""}>
                            <FormControl>
                              <SelectTrigger className="w-full h-10 rounded-xl bg-slate-50 border-none font-black text-xs px-3 focus:ring-2 focus:ring-orange-500 outline-none">
                                <SelectValue placeholder="请选择分类">
                                  {field.value && field.value !== "" 
                                    ? categories.find(c => c.id === field.value)?.name 
                                    : "请选择分类"}
                                </SelectValue>
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                          <FormMessage className="text-[10px] ml-1 mt-1 absolute" />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                <div className="h-1" />
                <FormField
                  control={itemForm.control}
                  name="is_new"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between p-3 rounded-2xl bg-orange-50/50 border border-orange-100 space-y-0 flex-row">
                      <div className="flex items-center gap-2">
                        <div className="size-8 bg-orange-100 rounded-lg flex items-center justify-center text-orange-600">
                          <Sparkles size={16} fill="currentColor" />
                        </div>
                        <div className="flex flex-col">
                          <span className="text-xs font-black text-orange-900">新品推荐</span>
                          <span className="text-[10px] text-orange-500 font-medium leading-none">增加在点单页的曝光度</span>
                        </div>
                      </div>
                      <FormControl>
                        <Checkbox 
                          checked={field.value} 
                          onCheckedChange={field.onChange}
                          className="size-5 rounded-lg border-orange-300 text-orange-500 data-[state=checked]:bg-orange-500 data-[state=checked]:text-white focus:ring-orange-500 transition-all cursor-pointer"
                        />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {itemForm.watch('is_new') && (
                  <div className="animate-in slide-in-from-top-2 duration-300 flex items-center justify-between">
                    <Label className="text-[11px] font-black uppercase tracking-widest text-slate-400 block ml-1">展示截止至</Label>
                    <FormField
                      control={itemForm.control}
                      name="new_until"
                      render={({ field }) => (
                        <FormItem className="space-y-0 relative">
                          <Popover>
                            <PopoverTrigger
                              className={cn(
                                "w-[140px] rounded-xl bg-slate-50 border-none font-black text-xs h-10 px-3 flex items-center justify-between transition-all active:scale-95",
                                !field.value && "text-slate-400"
                              )}
                            >
                                <FormControl>
                                  <div className="flex items-center justify-between w-full">
                                    {field.value ? (
                                      format(field.value, "y年MM月dd日")
                                    ) : (
                                      <span>选择截止日期</span>
                                    )}
                                    <CalendarIcon className="size-4 opacity-50" />
                                  </div>
                                </FormControl>
                            </PopoverTrigger>
                            <PopoverContent className="w-auto p-0 rounded-2xl border-none shadow-xl" align="end">
                              <Calendar
                                mode="single"
                                selected={field.value || undefined}
                                onSelect={field.onChange}
                                initialFocus
                                locale={zhCN}
                              />
                            </PopoverContent>
                          </Popover>
                          <FormMessage className="text-[10px] ml-1 mt-1 absolute right-2" />
                        </FormItem>
                      )}
                    />
                  </div>
                )}
              </div>
            </form>
          </Form>


          <DialogFooter className="mt-4 pb-2">
            <Button 
              type="button"
              className="w-full h-14 rounded-2xl bg-slate-900 hover:bg-black font-black text-white gap-2 shadow-xl shadow-slate-200 transition-all active:scale-95"
              onClick={itemForm.handleSubmit(saveItem, onInvalid)}
              disabled={saving}
            >
              {saving ? <div className="spinner border-white" /> : (
                <>
                  <Save size={20} strokeWidth={3} />
                  发布并保存菜品
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={showCatManager} onOpenChange={setShowCatManager}>
        <DialogContent className="sm:max-w-[420px] p-0 overflow-hidden rounded-[32px] border-none shadow-2xl">
          <DialogHeader className="p-6 pb-4">
            <DialogTitle className="text-xl font-black tracking-tight text-slate-900 text-left">
              分类管理
            </DialogTitle>
          </DialogHeader>
          
          <ScrollArea className="max-h-[60vh] px-6">
            <div className="space-y-2 pb-8 pt-2">
              <Button 
                variant="outline" 
                className="w-full h-14 rounded-2xl border-dashed border-slate-200 text-slate-400 hover:text-orange-500 hover:border-orange-200 hover:bg-orange-50 transition-all font-black gap-2 mb-4"
                onClick={() => { setCatName(''); setEditingCategory(null); setShowCategoryForm(true) }}
              >
                <Plus size={20} strokeWidth={3} /> 新建菜品分类
              </Button>

              {categories.map((cat) => {
                const hasItems = menuItems.some(i => i.category_id === cat.id)
                return (
                  <div key={cat.id} className="flex items-center justify-between p-4 bg-white rounded-2xl border border-slate-100 group transition-all hover:shadow-md hover:border-orange-100">
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-slate-700">{cat.name}</span>
                    </div>
                    <div className="flex items-center gap-1 opacity-100 transition-opacity">
                      <button 
                        onClick={() => { setEditingCategory(cat); setCatName(cat.name); setShowCategoryForm(true) }}
                        className="size-9 rounded-xl flex items-center justify-center bg-blue-50 text-blue-500 active:bg-blue-100 transition-colors"
                      >
                        <Pencil size={18} />
                      </button>
                      {!hasItems && (
                        <button 
                          onClick={() => deleteCategory(cat.id)}
                          className="size-9 rounded-xl flex items-center justify-center bg-rose-50 text-rose-500 active:bg-rose-100 transition-colors"
                        >
                          <Trash2 size={18} />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
              {categories.length === 0 && (
                <div className="py-12 flex flex-col items-center justify-center text-slate-300">
                  <FolderOpen size={48} strokeWidth={1} className="mb-2" />
                  <p className="text-[13px] font-medium">暂无分类，请先添加</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* 删除确认弹窗 */}
      <Dialog open={!!itemToDelete || !!catToDelete} onOpenChange={(open) => { if (!open) { setItemToDelete(null); setCatToDelete(null); } }}>
        <DialogContent className="sm:max-w-[400px] p-8 pb-7 rounded-[32px] border-none shadow-2xl grid gap-6">
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="size-20 rounded-3xl bg-rose-50 flex items-center justify-center text-rose-500 mb-2 shadow-inner">
              <AlertTriangle size={40} strokeWidth={2.5} />
            </div>
            <DialogHeader>
              <DialogTitle className="text-2xl font-black tracking-tighter text-slate-900">
                {catToDelete ? '确认移除该分类？' : '确认移除该菜品？'}
              </DialogTitle>
              <DialogDescription className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-2">
                当前操作属于关键敏感动作
              </DialogDescription>
            </DialogHeader>
            <p className="text-[14px] font-medium text-slate-500 leading-relaxed px-4">
              确定要删除该{catToDelete ? '分类' : '菜品'}吗？该操作不可逆。
            </p>
          </div>
          <div className="flex gap-4 pt-2">
            <Button variant="ghost" className="flex-1 h-14 rounded-2xl font-black text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all" onClick={() => { setItemToDelete(null); setCatToDelete(null); }}>
              取消
            </Button>
            <Button 
              className="flex-1 h-14 rounded-2xl bg-rose-600 hover:bg-rose-700 text-white font-black shadow-xl shadow-rose-200 transition-all active:scale-95" 
              onClick={itemToDelete ? confirmDeleteItem : confirmDeleteCategory}
            >
              确认删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

interface MerchantRow {
  id: string
  user_id: string
  email: string
  shop_name: string
  is_accepting_orders?: boolean
  announcement?: string | null
  business_hours?: {
    is_enabled?: boolean
    open_time?: string
    close_time?: string
  } | null
  payment_qr_urls?: {
    wechat?: string | null
    alipay?: string | null
  } | null
  membership_levels?: Json[] | null
}

interface CustomerRow {
  id: string
  phone?: string
  name?: string | null
  order_count?: number
  total_spent?: number
  points?: number
}

interface OrderRow {
  id: string
  merchant_id: string
  customer_id: string | null
  phone: string
  customer_name: string
  total_amount: number
  status: string
  scheduled_time?: string
  confirmed_at: string | null
  after_sales_status?: string
  is_coupon_refunded?: boolean | null
}

interface CouponRow {
  id: string
  title: string
  amount: number
  claimed_count?: number
  total_quantity?: number | null
}

interface CategoryRow {
  id: string
  name: string
}

interface MenuItemRow {
  id: string
  category_id: string
  name: string
  price: number
  is_available?: boolean
  image_url?: string | null
}

interface UserCouponRow {
  id: string
  status: string
  coupon_id: string
  customer_id: string
  used_at?: string | null
  coupon?: CouponRow
}

interface MessageRow {
  id: string
  order_id: string
  merchant_id: string
  sender: string
  content: string
  rating?: number | null
  msg_type: string
  is_read_by_merchant: boolean
  is_read_by_customer: boolean
}

function readEnvFile() {
  const content = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
  const env: Record<string, string> = {}

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const separatorIndex = line.indexOf('=')
    if (separatorIndex <= 0) continue

    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim()
    env[key] = value
  }

  return env
}

const env = readEnvFile()
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local')
}

function getSupabaseProjectRef() {
  return new URL(supabaseUrl).hostname.split('.')[0]
}

export function getSupabaseStorageKey() {
  return `sb-${getSupabaseProjectRef()}-auth-token`
}

function createAnonClient() {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

export async function createMerchantSession(merchantPhone: string, merchantPassword: string) {
  const client = createAnonClient()
  const signInEmail = `${merchantPhone}@merchant.app`

  const data = await retryOperation(
    async () => {
      const { data, error } = await client.auth.signInWithPassword({
        email: signInEmail,
        password: merchantPassword,
      })

      if (error || !data.session) {
        throw new Error(error?.message ?? 'no session returned')
      }

      return data
    },
    shouldRetry,
    'merchant session creation',
    5,
  )

  return data.session
}

function shouldRetry(message: string) {
  return (
    message.includes('502') ||
    message.includes('Bad gateway') ||
    message.includes('bad gateway') ||
    message.includes('Failed to fetch') ||
    message.includes('fetch failed') ||
    message.includes('Request rate limit reached') ||
    message.toLowerCase().includes('rate limit')
  )
}

async function retryOperation<T>(
  operation: () => Promise<T>,
  shouldRetryError: (message: string) => boolean,
  label: string,
  maxAttempts = 4,
) {
  let lastError: unknown = null

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error
      const message = error instanceof Error ? error.message : String(error)
      if (attempt === maxAttempts - 1 || !shouldRetryError(message)) {
        throw new Error(`${label} failed: ${message}`)
      }

      const waitMs = message.toLowerCase().includes('rate limit')
        ? 10_000 * (attempt + 1)
        : 1_000 * (attempt + 1)

      await new Promise((resolve) => setTimeout(resolve, waitMs))
    }
  }

  throw new Error(`${label} failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

async function requireData<T>(
  operation: () => PromiseLike<{ data: T | null; error: { message: string } | null }>,
  label: string,
) {
  let lastErrorMessage = 'empty response'

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await operation()
    if (!error && data) {
      return data
    }

    lastErrorMessage = error?.message ?? 'empty response'
    if (attempt === 4 || !shouldRetry(lastErrorMessage)) {
      throw new Error(`${label} failed: ${lastErrorMessage}`)
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000 * (attempt + 1)))
  }

  throw new Error(`${label} failed: ${lastErrorMessage}`)
}

export interface SeededMerchant {
  merchant: MerchantRow
  phone: string
  password: string
}

export interface SeededOrder {
  customer: CustomerRow
  order: OrderRow
}

export function createUniquePhone() {
  const suffix = `${Date.now()}`.slice(-8)
  return `13${suffix}${Math.floor(Math.random() * 10)}`
}

export async function createMerchantAccount(): Promise<SeededMerchant> {
  const client = createAnonClient()
  const phone = createUniquePhone()
  const password = `Pwd${Date.now()}`
  const email = `${phone}@merchant.app`

  const signUpData = await retryOperation(
    async () => {
      const { data, error } = await client.auth.signUp({
        email,
        password,
      })

      if (error || !data.user) {
        throw new Error(error?.message ?? 'no user returned')
      }

      return data
    },
    shouldRetry,
    'merchant sign up',
    10,
  )

  if (!signUpData.session) {
    await retryOperation(
      async () => {
        const { error } = await client.auth.signInWithPassword({ email, password })
        if (error) {
          throw new Error(error.message)
        }
      },
      shouldRetry,
      'merchant sign in after sign up',
      10,
    )
  }

  const merchant = await requireData(
    () => client
      .from('merchants')
      .insert({
        user_id: signUpData.user!.id,
        email: phone,
        shop_name: `E2E商家${phone.slice(-4)}`,
        real_name: `测试${phone.slice(-2)}`,
        id_card_num: '110101199003077777',
      } satisfies Record<string, Json>)
      .select('id, user_id, email, shop_name')
      .single(),
    'merchant insert',
  )

  return { merchant, phone, password }
}

export async function findMerchantByPhone(phone: string) {
  const client = createAnonClient()
  const { data, error } = await client
    .from('merchants')
    .select('id, user_id, email, shop_name')
    .eq('email', phone)
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) {
    if (shouldRetry(error.message)) {
      return null
    }
    throw new Error(`merchant by phone lookup failed: ${error.message}`)
  }

  return data?.[0] ?? null
}

/* eslint-disable @typescript-eslint/no-unused-vars */
export async function createCustomerOrder(
  merchantId: string,
  amount = 66,
  overrides: {
    customerId?: string | null
    phone?: string
    customerName?: string
    address?: string
    status?: string
    scheduledTime?: string
  } = {},
): Promise<SeededOrder> {
  const client = createAnonClient()
  const customerPhone = overrides.phone ?? createUniquePhone()
  const customerName = overrides.customerName ?? `测试顾客${customerPhone.slice(-4)}`
  const address = overrides.address ?? '上海市浦东新区测试路 88 号'
  const scheduledTime = overrides.scheduledTime ?? new Date(Date.now() + 30 * 60 * 1000).toISOString()
  const status = overrides.status ?? 'pending'

  const customer = await requireData(
    () => client
      .from('customers')
      .insert({
        merchant_id: merchantId,
        phone: customerPhone,
        name: `测试顾客${customerPhone.slice(-4)}`,
        address: '上海市浦东新区测试路 88 号',
        order_count: 1,
        total_spent: amount,
        points: Math.floor(amount),
      } satisfies Record<string, Json>)
      .select('id')
      .single(),
    'customer insert',
  ) as unknown as CustomerRow

  const order = await requireData(
    () => client
      .from('orders')
      .insert({
        merchant_id: merchantId,
        customer_id: customer.id,
        order_type: 'personal',
        phone: customerPhone,
        customer_name: `测试顾客${customerPhone.slice(-4)}`,
        address: '上海市浦东新区测试路 88 号',
        scheduled_time: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        original_amount: amount,
        total_amount: amount,
        vip_discount_rate: 1,
        vip_discount_amount: 0,
        coupon_discount_amount: 0,
        coupon_ids: [],
        status: 'pending',
        after_sales_status: 'none',
      } satisfies Record<string, Json>)
      .select('id, merchant_id, customer_id, phone, customer_name, total_amount, status, confirmed_at')
      .single(),
    'order insert',
  ) as unknown as OrderRow

  await requireData(
    () => client
      .from('order_items')
      .insert({
        order_id: order.id,
        menu_item_id: null,
        item_name: 'E2E测试套餐',
        item_price: amount,
        quantity: 1,
        remark: null,
      } satisfies Record<string, Json>)
      .select('id')
      .single(),
    'order item insert',
  )

  return { customer, order }
}
/* eslint-enable @typescript-eslint/no-unused-vars */

export async function getOrderById(orderId: string) {
  const client = createAnonClient()
  return requireData(
    () => client
      .from('orders')
      .select('id, merchant_id, customer_id, phone, customer_name, total_amount, status, scheduled_time, confirmed_at, penalty_rate, penalty_amount, refund_amount, after_sales_status, is_coupon_refunded')
      .eq('id', orderId)
      .single(),
    'order fetch',
  )
}

export async function updateOrder(orderId: string, patch: Record<string, Json>) {
  const client = createAnonClient()
  return requireData(
    () => client
      .from('orders')
      .update(patch)
      .eq('id', orderId)
      .select('id')
      .single(),
    'order update',
  )
}

export async function getCustomerById(customerId: string) {
  const client = createAnonClient()
  return requireData(
    () => client
      .from('customers')
      .select('id, order_count, total_spent, points')
      .eq('id', customerId)
      .single(),
    'customer fetch',
  )
}

export async function getCustomerByPhone(merchantId: string, phone: string) {
  const client = createAnonClient()
  const customers = await requireData(
    () => client
      .from('customers')
      .select('id, phone, name, order_count, total_spent, points')
      .eq('merchant_id', merchantId)
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1),
    'customer by phone fetch',
  ) as CustomerRow[]

  const [customer] = customers
  if (!customer) {
    throw new Error('customer by phone fetch failed: empty response')
  }

  return customer
}

export async function findCustomerByPhone(merchantId: string, phone: string) {
  const client = createAnonClient()
  const { data, error } = await client
    .from('customers')
    .select('id, phone, name, order_count, total_spent, points')
    .eq('merchant_id', merchantId)
    .eq('phone', phone)
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) {
    if (shouldRetry(error.message)) {
      return null
    }
    throw new Error(`customer by phone lookup failed: ${error.message}`)
  }

  return data?.[0] ?? null
}

export async function createCustomerForMerchant(params: {
  merchantId: string
  phone?: string
  name?: string
  address?: string
  points?: number
  orderCount?: number
  totalSpent?: number
}) {
  const client = createAnonClient()
  const {
    merchantId,
    phone = createUniquePhone(),
    name = `E2E顾客${Date.now().toString().slice(-4)}`,
    address = '上海市浦东新区测试路 99 号',
    points = 0,
    orderCount = 0,
    totalSpent = 0,
  } = params

  return requireData(
    () => client
      .from('customers')
      .insert({
        merchant_id: merchantId,
        phone,
        name,
        address,
        points,
        order_count: orderCount,
        total_spent: totalSpent,
      } satisfies Record<string, Json>)
      .select('id, phone, name, order_count, total_spent, points')
      .single(),
    'customer create for merchant',
  ) as unknown as Promise<CustomerRow>
}

export async function createMenuItemForMerchant(params: {
  merchantId: string
  merchantPhone: string
  merchantPassword: string
  categoryName?: string
  itemName?: string
  price?: number
  description?: string
}) {
  const merchantClient = createAnonClient()
  const {
    merchantId,
    merchantPhone,
    merchantPassword,
    categoryName = `E2E分类${Date.now().toString().slice(-4)}`,
    itemName = `E2E菜品${Date.now().toString().slice(-4)}`,
    price = 28,
    description = 'E2E 下单测试菜品',
  } = params

  const signInEmail = `${merchantPhone}@merchant.app`
  const { error: signInError } = await retryOperation(
    () => merchantClient.auth.signInWithPassword({
      email: signInEmail,
      password: merchantPassword,
    }),
    shouldRetry,
    'merchant sign in for menu item creation',
  )

  if (signInError) {
    throw new Error(`merchant sign in for menu item creation failed: ${signInError.message}`)
  }

  const category = await requireData(
    () => merchantClient
      .from('categories')
      .insert({
        merchant_id: merchantId,
        name: categoryName,
        sort_order: 0,
      } satisfies Record<string, Json>)
      .select('id, name')
      .single(),
    'category insert',
  ) as unknown as CategoryRow

  const menuItem = await requireData(
    () => merchantClient
      .from('menu_items')
      .insert({
        merchant_id: merchantId,
        category_id: category.id,
        name: itemName,
        description,
        price,
        unit: '份',
        image_url: null,
        is_new: false,
        is_available: true,
      } satisfies Record<string, Json>)
      .select('id, category_id, name, price')
      .single(),
    'menu item insert',
  ) as unknown as MenuItemRow

  return { category, menuItem }
}

export async function createCategoryForMerchant(params: {
  merchantId: string
  merchantPhone: string
  merchantPassword: string
  categoryName?: string
}) {
  const merchantClient = createAnonClient()
  const {
    merchantId,
    merchantPhone,
    merchantPassword,
    categoryName = `E2E分类${Date.now().toString().slice(-4)}`,
  } = params

  const signInEmail = `${merchantPhone}@merchant.app`
  const { error: signInError } = await retryOperation(
    () => merchantClient.auth.signInWithPassword({
      email: signInEmail,
      password: merchantPassword,
    }),
    shouldRetry,
    'merchant sign in for category creation',
  )

  if (signInError) {
    throw new Error(`merchant sign in for category creation failed: ${signInError.message}`)
  }

  const category = await requireData(
    () => merchantClient
      .from('categories')
      .insert({
        merchant_id: merchantId,
        name: categoryName,
        sort_order: 0,
      } satisfies Record<string, Json>)
      .select('id, name')
      .single(),
    'category create for merchant',
  ) as unknown as CategoryRow

  return category
}

export async function setMenuItemAvailability(params: {
  merchantPhone: string
  merchantPassword: string
  itemId: string
  isAvailable: boolean
}) {
  const { merchantPhone, merchantPassword, itemId, isAvailable } = params
  const merchantClient = createAnonClient()
  const signInEmail = `${merchantPhone}@merchant.app`
  const { error: signInError } = await retryOperation(
    () => merchantClient.auth.signInWithPassword({
      email: signInEmail,
      password: merchantPassword,
    }),
    shouldRetry,
    'merchant sign in for menu item availability update',
  )
  if (signInError) {
    throw new Error(`merchant sign in for availability update failed: ${signInError.message}`)
  }

  const { error } = await merchantClient
    .from('menu_items')
    .update({ is_available: isAvailable })
    .eq('id', itemId)

  if (error) {
    throw new Error(`setMenuItemAvailability failed: ${error.message}`)
  }
}

export async function getLatestOrderForPhone(merchantId: string, phone: string) {
  const client = createAnonClient()
  const orders = await requireData(
    () => client
      .from('orders')
      .select('id, merchant_id, customer_id, phone, customer_name, total_amount, status, confirmed_at, original_amount, vip_discount_rate, vip_discount_amount, coupon_discount_amount, coupon_ids')
      .eq('merchant_id', merchantId)
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1),
    'latest order fetch',
  ) as Array<OrderRow & {
    original_amount: number
    vip_discount_rate: number
    vip_discount_amount: number
    coupon_discount_amount: number
    coupon_ids: string[] | null
  }>

  const [latestOrder] = orders
  if (!latestOrder) {
    throw new Error('latest order fetch failed: empty response')
  }

  return latestOrder
}

export async function findLatestOrderForPhone(merchantId: string, phone: string) {
  const client = createAnonClient()
  const { data, error } = await client
    .from('orders')
    .select('id, merchant_id, customer_id, phone, customer_name, total_amount, status, confirmed_at, original_amount, vip_discount_rate, vip_discount_amount, coupon_discount_amount, coupon_ids')
    .eq('merchant_id', merchantId)
    .eq('phone', phone)
    .order('created_at', { ascending: false })
    .limit(1)

  if (error) {
    if (shouldRetry(error.message)) {
      return null
    }
    throw new Error(`latest order lookup failed: ${error.message}`)
  }

  return data?.[0] ?? null
}

export async function getOrdersByPhone(merchantId: string, phone: string) {
  const client = createAnonClient()
  return requireData(
    () => client
      .from('orders')
      .select('id, merchant_id, customer_id, phone, customer_name, total_amount, status, confirmed_at, original_amount, vip_discount_rate, vip_discount_amount, coupon_discount_amount, coupon_ids')
      .eq('merchant_id', merchantId)
      .eq('phone', phone)
      .order('created_at', { ascending: false }),
    'orders by phone fetch',
  ) as Promise<Array<OrderRow & {
    original_amount: number
    vip_discount_rate: number
    vip_discount_amount: number
    coupon_discount_amount: number
    coupon_ids: string[] | null
  }>>
}

export async function getOrderItems(orderId: string) {
  const client = createAnonClient()
  return requireData(
    () => client
      .from('order_items')
      .select('id, order_id, menu_item_id, item_name, item_price, quantity, remark')
      .eq('order_id', orderId),
    'order items fetch',
  ) as Promise<Array<{
    id: string
    order_id: string
    menu_item_id: string | null
    item_name: string
    item_price: number
    quantity: number
    remark: string | null
  }>>
}

export async function updateMerchantAsMerchant(params: {
  merchantId: string
  merchantPhone: string
  merchantPassword: string
  patch: Record<string, Json>
}) {
  const { merchantId, merchantPhone, merchantPassword, patch } = params
  const merchantClient = await createMerchantAuthedClient(merchantPhone, merchantPassword)

  return requireData(
    () => merchantClient
      .from('merchants')
      .update(patch)
      .eq('id', merchantId)
      .select('id')
      .single(),
    'merchant update',
  )
}

export async function getMerchantById(merchantId: string) {
  const client = createAnonClient()
  return requireData(
    () => client
      .from('merchants')
      .select('id, user_id, email, shop_name, is_accepting_orders, announcement, business_hours, payment_qr_urls, membership_levels')
      .eq('id', merchantId)
      .single(),
    'merchant fetch',
  ) as Promise<MerchantRow>
}

export async function createDisabledDateAsMerchant(params: {
  merchantId: string
  merchantPhone: string
  merchantPassword: string
  disabledDate: string
  reason?: string | null
}) {
  const { merchantId, merchantPhone, merchantPassword, disabledDate, reason = null } = params
  const merchantClient = createAnonClient()
  const signInEmail = `${merchantPhone}@merchant.app`

  const { error: signInError } = await merchantClient.auth.signInWithPassword({
    email: signInEmail,
    password: merchantPassword,
  })

  if (signInError) {
    throw new Error(`merchant sign in for disabled date creation failed: ${signInError.message}`)
  }

  return requireData(
    () => merchantClient
      .from('disabled_dates')
      .insert({
        merchant_id: merchantId,
        disabled_date: disabledDate,
        reason,
      } satisfies Record<string, Json>)
      .select('id')
      .single(),
    'disabled date insert',
  )
}

export async function createUsedCouponForCustomer(merchantId: string, customerId: string, amount = 6) {
  const client = createAnonClient()
  const suffix = `${Date.now()}`.slice(-4)

  const coupon = await requireData(
    () => client
      .from('coupons')
      .insert({
        merchant_id: merchantId,
        title: `E2E券${suffix}`,
        amount,
        min_spend: 0,
        status: 'active',
        is_newcomer_reward: false,
        expiry_days: 7,
      } satisfies Record<string, Json>)
      .select('id, title, amount')
      .single(),
    'coupon insert',
  ) as unknown as { id: string }

  const userCoupon = await requireData(
    () => client
      .from('user_coupons')
      .insert({
        customer_id: customerId,
        coupon_id: coupon.id,
        status: 'used',
        used_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      } satisfies Record<string, Json>)
      .select('id, status, coupon_id, customer_id')
      .single(),
    'user coupon insert',
  )

  return {
    coupon: coupon as CouponRow,
    userCoupon: userCoupon as UserCouponRow,
  }
}

export async function createCouponAsMerchant(params: {
  merchantId: string
  merchantPhone: string
  merchantPassword: string
  title?: string
  amount?: number
  minSpend?: number
  isNewcomerReward?: boolean
  stackable?: boolean
  targetType?: 'all' | 'category' | 'customer'
  targetCategoryId?: string | null
  targetItemIds?: string[]
  expiryDays?: number
  totalQuantity?: number | null
}) {
  const {
    merchantId,
    merchantPhone,
    merchantPassword,
    title = `E2E券${Date.now().toString().slice(-4)}`,
    amount = 6,
    minSpend = 0,
    isNewcomerReward = false,
    stackable = false,
    targetType = 'all',
    targetCategoryId = null,
    targetItemIds = [],
    expiryDays = 7,
    totalQuantity = null,
  } = params
  const merchantClient = createAnonClient()
  const signInEmail = `${merchantPhone}@merchant.app`

  await retryOperation(
    async () => {
      const { error } = await merchantClient.auth.signInWithPassword({
        email: signInEmail,
        password: merchantPassword,
      })

      if (error) {
        throw new Error(error.message || JSON.stringify(error))
      }
    },
    shouldRetry,
    'merchant sign in for coupon creation',
    5,
  )

  return requireData(
    () => merchantClient
      .from('coupons')
      .insert({
        merchant_id: merchantId,
        title,
        amount,
        min_spend: minSpend,
        status: 'active',
        is_newcomer_reward: isNewcomerReward,
        expiry_days: expiryDays,
        stackable,
        target_type: targetType,
        target_category_id: targetCategoryId,
        target_item_ids: targetItemIds,
        total_quantity: totalQuantity,
      } satisfies Record<string, Json>)
      .select('id, title, amount')
      .single(),
    'coupon insert',
  ) as Promise<CouponRow>
}

export async function claimCouponForCustomer(params: {
  couponId: string
  customerId: string
  expiresAt?: string
}) {
  const client = createAnonClient()
  const {
    couponId,
    customerId,
    expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  } = params

  return requireData(
    () => client.rpc('claim_coupon', {
      p_coupon_id: couponId,
      p_customer_id: customerId,
      p_expires_at: expiresAt,
    }),
    'claim coupon rpc',
  ) as Promise<boolean>
}

export async function getCouponById(couponId: string) {
  const client = createAnonClient()
  const coupons = await requireData(
    () => client
      .from('coupons')
      .select('id, title, amount, min_spend, status, merchant_id, claimed_count, total_quantity')
      .eq('id', couponId),
    'coupon fetch',
  ) as Array<CouponRow & {
    min_spend: number
    status: string
    merchant_id: string
  }>

  const [coupon] = coupons
  if (!coupon) {
    throw new Error('coupon fetch failed: empty response')
  }

  return coupon
}

export async function getLatestCouponByTitle(merchantId: string, title: string) {
  const client = createAnonClient()
  const coupons = await requireData(
    () => client
      .from('coupons')
      .select('id, title, amount, min_spend, status, merchant_id')
      .eq('merchant_id', merchantId)
      .eq('title', title)
      .order('created_at', { ascending: false })
      .limit(1),
    'latest coupon by title fetch',
  ) as Array<CouponRow & {
    min_spend: number
    status: string
    merchant_id: string
  }>

  const [coupon] = coupons
  if (!coupon) {
    throw new Error('latest coupon by title fetch failed: empty response')
  }

  return coupon
}

async function createMerchantAuthedClient(merchantPhone: string, merchantPassword: string) {
  const merchantClient = createAnonClient()
  const signInEmail = `${merchantPhone}@merchant.app`

  await retryOperation(
    async () => {
      const { error } = await merchantClient.auth.signInWithPassword({
        email: signInEmail,
        password: merchantPassword,
      })

      if (error) {
        throw new Error(error.message)
      }
    },
    shouldRetry,
    'merchant sign in for authed helper',
    5,
  )

  return merchantClient
}

export async function getCategoryByNameAsMerchant(params: {
  merchantId: string
  categoryName: string
  merchantPhone: string
  merchantPassword: string
}) {
  const { merchantId, categoryName, merchantPhone, merchantPassword } = params
  const merchantClient = await createMerchantAuthedClient(merchantPhone, merchantPassword)
  const categories = await requireData(
    () => merchantClient
      .from('categories')
      .select('id, name')
      .eq('merchant_id', merchantId)
      .eq('name', categoryName)
      .order('created_at', { ascending: false })
      .limit(1),
    'category fetch as merchant',
  ) as CategoryRow[]

  const [category] = categories
  if (!category) {
    throw new Error('category fetch as merchant failed: empty response')
  }

  return category
}

export async function getMenuItemByIdAsMerchant(params: {
  menuItemId: string
  merchantPhone: string
  merchantPassword: string
}) {
  const { menuItemId, merchantPhone, merchantPassword } = params
  const merchantClient = await createMerchantAuthedClient(merchantPhone, merchantPassword)
  const menuItems = await requireData(
    () => merchantClient
      .from('menu_items')
      .select('id, category_id, name, price, is_available, image_url')
      .eq('id', menuItemId),
    'menu item fetch as merchant',
  ) as MenuItemRow[]

  const [menuItem] = menuItems
  if (!menuItem) {
    throw new Error('menu item fetch as merchant failed: empty response')
  }

  return menuItem
}

export async function getMenuItemByNameAsMerchant(params: {
  merchantId: string
  itemName: string
  merchantPhone: string
  merchantPassword: string
}) {
  const { merchantId, itemName, merchantPhone, merchantPassword } = params
  const merchantClient = await createMerchantAuthedClient(merchantPhone, merchantPassword)
  const menuItems = await requireData(
    () => merchantClient
      .from('menu_items')
      .select('id, category_id, name, price, is_available, image_url')
      .eq('merchant_id', merchantId)
      .eq('name', itemName)
      .order('created_at', { ascending: false })
      .limit(1),
    'menu item by name fetch as merchant',
  ) as MenuItemRow[]

  const [menuItem] = menuItems
  if (!menuItem) {
    throw new Error('menu item by name fetch as merchant failed: empty response')
  }

  return menuItem
}

export async function getDisabledDatesAsMerchant(params: {
  merchantId: string
  merchantPhone: string
  merchantPassword: string
}) {
  const { merchantId, merchantPhone, merchantPassword } = params
  const merchantClient = await createMerchantAuthedClient(merchantPhone, merchantPassword)
  return requireData(
    () => merchantClient
      .from('disabled_dates')
      .select('id, disabled_date, reason')
      .eq('merchant_id', merchantId)
      .order('disabled_date', { ascending: true }),
    'disabled dates fetch as merchant',
  ) as Promise<Array<{ id: string; disabled_date: string; reason: string | null }>>
}

export async function getCouponByIdAsMerchant(params: {
  couponId: string
  merchantPhone: string
  merchantPassword: string
}) {
  const { couponId, merchantPhone, merchantPassword } = params
  const merchantClient = await createMerchantAuthedClient(merchantPhone, merchantPassword)
  const coupons = await requireData(
    () => merchantClient
      .from('coupons')
      .select('id, title, amount, min_spend, status, merchant_id, claimed_count, total_quantity, stackable, target_type, target_category_id, target_item_ids')
      .eq('id', couponId),
    'coupon fetch as merchant',
  ) as Array<CouponRow & {
    min_spend: number
    status: string
    merchant_id: string
    stackable: boolean
    target_type: string
    target_category_id: string | null
    target_item_ids: string[] | null
  }>

  const [coupon] = coupons
  if (!coupon) {
    throw new Error('coupon fetch as merchant failed: empty response')
  }

  return coupon
}

export async function getLatestCouponByTitleAsMerchant(params: {
  merchantId: string
  title: string
  merchantPhone: string
  merchantPassword: string
}) {
  const { merchantId, title, merchantPhone, merchantPassword } = params
  const merchantClient = await createMerchantAuthedClient(merchantPhone, merchantPassword)
  const coupons = await requireData(
    () => merchantClient
      .from('coupons')
      .select('id, title, amount, min_spend, status, merchant_id')
      .eq('merchant_id', merchantId)
      .eq('title', title)
      .order('created_at', { ascending: false })
      .limit(1),
    'latest coupon by title fetch as merchant',
  ) as Array<CouponRow & {
    min_spend: number
    status: string
    merchant_id: string
  }>

  const [coupon] = coupons
  if (!coupon) {
    throw new Error('latest coupon by title fetch as merchant failed: empty response')
  }

  return coupon
}

export async function updateCouponAsMerchant(params: {
  couponId: string
  merchantPhone: string
  merchantPassword: string
  patch: Record<string, Json>
}) {
  const { couponId, merchantPhone, merchantPassword, patch } = params
  const merchantClient = await createMerchantAuthedClient(merchantPhone, merchantPassword)

  return requireData(
    () => merchantClient
      .from('coupons')
      .update(patch)
      .eq('id', couponId)
      .select('id, title, amount, claimed_count, total_quantity')
      .single(),
    'coupon update as merchant',
  ) as Promise<CouponRow>
}

export async function createUsedCouponForCustomerAsMerchant(params: {
  merchantId: string
  merchantPhone: string
  merchantPassword: string
  customerId: string
  amount?: number
}) {
  const { merchantId, merchantPhone, merchantPassword, customerId, amount = 6 } = params
  const merchantClient = createAnonClient()
  const signInEmail = `${merchantPhone}@merchant.app`

  const { error: signInError } = await merchantClient.auth.signInWithPassword({
    email: signInEmail,
    password: merchantPassword,
  })

  if (signInError) {
    throw new Error(`merchant sign in for coupon creation failed: ${signInError.message}`)
  }

  const suffix = `${Date.now()}`.slice(-4)
  const coupon = await requireData(
    () => merchantClient
      .from('coupons')
      .insert({
        merchant_id: merchantId,
        title: `E2E券${suffix}`,
        amount,
        min_spend: 0,
        status: 'active',
        is_newcomer_reward: false,
        expiry_days: 7,
      } satisfies Record<string, Json>)
      .select('id, title, amount')
      .single(),
    'coupon insert',
  ) as unknown as { id: string }

  const publicClient = createAnonClient()
  const userCoupon = await requireData(
    () => publicClient
      .from('user_coupons')
      .insert({
        customer_id: customerId,
        coupon_id: coupon.id,
        status: 'used',
        used_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      } satisfies Record<string, Json>)
      .select('id, status, coupon_id, customer_id')
      .single(),
    'user coupon insert',
  )

  return {
    coupon: coupon as CouponRow,
    userCoupon: userCoupon as UserCouponRow,
  }
}

export async function createUnusedCouponForCustomerAsMerchant(params: {
  merchantId: string
  merchantPhone: string
  merchantPassword: string
  customerId: string
  amount?: number
  minSpend?: number
  title?: string
  stackable?: boolean
  targetType?: 'all' | 'category' | 'customer'
  targetCategoryId?: string | null
  targetItemIds?: string[]
  expiresAt?: string
}) {
  const {
    merchantId,
    merchantPhone,
    merchantPassword,
    customerId,
    amount = 6,
    minSpend = 0,
    title,
    stackable = false,
    targetType = 'all',
    targetCategoryId = null,
    targetItemIds = [],
    expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  } = params

  const coupon = await createCouponAsMerchant({
    merchantId,
    merchantPhone,
    merchantPassword,
    title,
    amount,
    minSpend,
    stackable,
    targetType,
    targetCategoryId,
    targetItemIds,
  })

  const publicClient = createAnonClient()
  const userCoupon = await requireData(
    () => publicClient
      .from('user_coupons')
      .insert({
        customer_id: customerId,
        coupon_id: coupon.id,
        status: 'unused',
        used_at: null,
        expires_at: expiresAt,
      } satisfies Record<string, Json>)
      .select('id, status, coupon_id, customer_id, used_at')
      .single(),
    'user coupon insert',
  )

  return {
    coupon: coupon as CouponRow,
    userCoupon: userCoupon as UserCouponRow,
  }
}

export async function getUserCouponById(userCouponId: string) {
  const client = createAnonClient()
  return requireData(
    () => client
      .from('user_coupons')
      .select('id, status, coupon_id, customer_id, used_at')
      .eq('id', userCouponId)
      .single(),
    'user coupon fetch',
  )
}

export async function getUserCouponsByCustomer(customerId: string) {
  const client = createAnonClient()
  return requireData(
    () => client
      .from('user_coupons')
      .select('id, status, coupon_id, customer_id, used_at, coupon:coupons(id, title, amount)')
      .eq('customer_id', customerId),
    'user coupons by customer fetch',
  ) as unknown as Promise<UserCouponRow[]>
}

export async function createCustomerMessage(params: {
  orderId: string
  merchantId: string
  content: string
  rating?: number | null
  msgType?: 'normal' | 'after_sales' | 'after_sales_closed'
}) {
  const client = createAnonClient()
  const { orderId, merchantId, content, rating = null, msgType = 'normal' } = params

  return requireData(
    () => client
      .from('messages')
      .insert({
        order_id: orderId,
        merchant_id: merchantId,
        sender: 'customer',
        content,
        rating,
        msg_type: msgType,
        is_read_by_merchant: false,
        is_read_by_customer: true,
      } satisfies Record<string, Json>)
      .select('id, order_id, merchant_id, sender, content, rating, msg_type, is_read_by_merchant, is_read_by_customer')
      .single(),
    'customer message insert',
  ) as Promise<MessageRow>
}

export async function createMerchantMessage(params: {
  orderId: string
  merchantId: string
  content: string
  msgType?: 'normal' | 'after_sales' | 'after_sales_closed'
}) {
  const client = createAnonClient()
  const { orderId, merchantId, content, msgType = 'normal' } = params

  return requireData(
    () => client
      .from('messages')
      .insert({
        order_id: orderId,
        merchant_id: merchantId,
        sender: 'merchant',
        content,
        rating: null,
        msg_type: msgType,
        is_read_by_merchant: true,
        is_read_by_customer: false,
      } satisfies Record<string, Json>)
      .select('id, order_id, merchant_id, sender, content, msg_type, is_read_by_merchant, is_read_by_customer')
      .single(),
    'merchant message insert',
  ) as Promise<MessageRow>
}

export async function getMessageById(messageId: string) {
  const client = createAnonClient()
  return requireData(
    () => client
      .from('messages')
      .select('id, order_id, merchant_id, sender, content, rating, msg_type, is_read_by_merchant, is_read_by_customer')
      .eq('id', messageId)
      .single(),
    'message fetch',
  ) as Promise<MessageRow>
}

export async function getMessagesByOrder(orderId: string) {
  const client = createAnonClient()
  return requireData(
    () => client
      .from('messages')
      .select('id, order_id, merchant_id, sender, content, rating, msg_type, is_read_by_merchant, is_read_by_customer')
      .eq('order_id', orderId)
      .order('created_at', { ascending: true }),
    'messages by order fetch',
  ) as Promise<MessageRow[]>
}

export function createTestClient(): SupabaseClient {
  return createAnonClient()
}

export function createTestId() {
  return randomUUID()
}

export async function createOrderForCustomer(params: {
  merchantId: string
  customerId: string
  phone: string
  customerName: string
  address?: string
  amount?: number
  status?: string
  scheduledTime?: string
}) {
  const client = createAnonClient()
  const {
    merchantId,
    customerId,
    phone,
    customerName,
    address = '上海市浦东新区测试路 88 号',
    amount = 66,
    status = 'pending',
    scheduledTime = new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  } = params

  const order = await requireData(
    () => client
      .from('orders')
      .insert({
        merchant_id: merchantId,
        customer_id: customerId,
        order_type: 'personal',
        phone,
        customer_name: customerName,
        address,
        scheduled_time: scheduledTime,
        original_amount: amount,
        total_amount: amount,
        vip_discount_rate: 1,
        vip_discount_amount: 0,
        coupon_discount_amount: 0,
        coupon_ids: [],
        status,
        after_sales_status: 'none',
      } satisfies Record<string, Json>)
      .select('id, merchant_id, customer_id, phone, customer_name, total_amount, status, scheduled_time, confirmed_at')
      .single(),
    'order create for customer',
  ) as OrderRow

  await requireData(
    () => client
      .from('order_items')
      .insert({
        order_id: order.id,
        menu_item_id: null,
        item_name: 'E2E测试套餐',
        item_price: amount,
        quantity: 1,
        remark: null,
      } satisfies Record<string, Json>)
      .select('id')
      .single(),
    'order item create for customer',
  )

  return order
}

export async function getLatestOrderWithScheduleForPhone(merchantId: string, phone: string) {
  const client = createAnonClient()
  const orders = await requireData(
    () => client
      .from('orders')
      .select('id, merchant_id, customer_id, phone, customer_name, total_amount, status, scheduled_time, confirmed_at, original_amount, vip_discount_rate, vip_discount_amount, coupon_discount_amount, coupon_ids')
      .eq('merchant_id', merchantId)
      .eq('phone', phone)
      .order('created_at', { ascending: false })
      .limit(1),
    'latest order with schedule fetch',
  ) as Array<OrderRow & {
    original_amount: number
    vip_discount_rate: number
    vip_discount_amount: number
    coupon_discount_amount: number
    coupon_ids: string[] | null
  }>

  const [latestOrder] = orders
  if (!latestOrder) {
    throw new Error('latest order with schedule fetch failed: empty response')
  }

  return latestOrder
}

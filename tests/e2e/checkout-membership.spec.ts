import { expect, test } from '@playwright/test'

import {
  createCouponAsMerchant,
  createCategoryForMerchant,
  createCustomerForMerchant,
  createDisabledDateAsMerchant,
  createUniquePhone,
  createMenuItemForMerchant,
  createMerchantAccount,
  createUnusedCouponForCustomerAsMerchant,
  findCustomerByPhone,
  findLatestOrderForPhone,
  getCustomerById,
  getCustomerByPhone,
  getLatestOrderForPhone,
  getOrderItems,
  getOrdersByPhone,
  getUserCouponById,
  getUserCouponsByCustomer,
  updateMerchantAsMerchant,
  updateCouponAsMerchant,
} from './helpers/supabase'

const POLL_TIMEOUT_MS = 30_000

function getDefaultScheduledDateInShanghai() {
  const now = new Date()
  const dateFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const timeFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })

  const [hour, minute] = timeFormatter.format(now).split(':').map(Number)
  const futureMinutes = hour * 60 + minute + 30
  const closeMinutes = 22 * 60

  const targetDate = new Date(now)
  if (futureMinutes > closeMinutes) {
    targetDate.setDate(targetDate.getDate() + 1)
  }

  return dateFormatter.format(targetDate)
}

async function fillAndSubmitOrder(params: {
  page: import('@playwright/test').Page
  merchantId: string
  itemId: string
  customerName: string
  phone: string
  address: string
}) {
  const { page, merchantId, itemId, customerName, phone, address } = params

  await openMenuWithItem(page, merchantId, itemId)

  await page.getByTestId(`add-to-cart-${itemId}`).click()
  await expect(page.getByTestId('checkout-button')).toBeVisible()
  await page.getByTestId('checkout-button').click()

  const form = page.getByTestId('order-form')
  await expect(form).toBeVisible()

  await form.locator('input').nth(0).fill(customerName)
  await form.locator('input[type="tel"]').fill(phone)
  await form.locator('textarea').fill(address)
  await form.getByTestId('submit-order-button').click()
}

async function openMenuWithItem(
  page: import('@playwright/test').Page,
  merchantId: string,
  itemId: string,
) {
  const itemLocator = page.getByTestId(`menu-item-${itemId}`)

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(`/m/${merchantId}`)
    if ((await itemLocator.count()) > 0) {
      await expect(itemLocator).toBeVisible({ timeout: POLL_TIMEOUT_MS })
      return
    }

    await page.waitForTimeout(1_000 * (attempt + 1))
  }

  await expect(itemLocator).toBeVisible({ timeout: POLL_TIMEOUT_MS })
}

async function openCheckoutForItem(params: {
  page: import('@playwright/test').Page
  merchantId: string
  itemId: string
}) {
  const { page, merchantId, itemId } = params

  await openMenuWithItem(page, merchantId, itemId)
  await page.getByTestId(`add-to-cart-${itemId}`).click()
  await page.getByTestId('checkout-button').click()
  await expect(page.getByTestId('order-form')).toBeVisible()
}

async function fillCheckoutForm(params: {
  page: import('@playwright/test').Page
  customerName: string
  phone: string
  address: string
}) {
  const { page, customerName, phone, address } = params
  const form = page.getByTestId('order-form')

  await form.locator('input').nth(0).fill(customerName)
  await form.locator('input[type="tel"]').fill(phone)
  await form.locator('textarea').fill(address)
}

test.describe('checkout and membership flows', () => {
  test.describe.configure({ mode: 'serial' })
  test.setTimeout(120_000)

  test('customer can place an order from the menu page', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 下单主链路套餐',
      price: 36,
    })

    const customerName = '下单测试顾客'
    const phone = `139${Date.now().toString().slice(-8)}`
    const address = '上海市浦东新区订单测试路 18 号'

    await fillAndSubmitOrder({
      page,
      merchantId: merchant.id,
      itemId: menuItem.id,
      customerName,
      phone,
      address,
    })

    await expect
      .poll(async () => findLatestOrderForPhone(merchant.id, phone), {
        message: 'expected customer checkout to create a pending order',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        customer_name: customerName,
        status: 'pending',
        original_amount: 36,
        total_amount: 36,
        vip_discount_rate: 1,
        vip_discount_amount: 0,
        coupon_discount_amount: 0,
      })

    const latestOrder = await getLatestOrderForPhone(merchant.id, phone)
    await expect
      .poll(async () => getOrderItems(latestOrder.id), {
        message: 'expected order items to be created for the placed order',
        timeout: POLL_TIMEOUT_MS,
      })
      .toHaveLength(1)

    const orderItems = await getOrderItems(latestOrder.id)
    expect(orderItems[0]).toMatchObject({
      menu_item_id: menuItem.id,
      item_name: menuItem.name,
      item_price: 36,
      quantity: 1,
    })

    const customer = await getCustomerByPhone(merchant.id, phone)
    expect(customer).toMatchObject({
      name: customerName,
      order_count: 1,
      points: 36,
    })
    expect(Number(customer.total_spent)).toBe(36)
  })

  test('double clicking submit still creates only one order', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 重复提交商品',
      price: 28,
    })

    const customerPhone = `137${Date.now().toString().slice(-8)}`

    await openMenuWithItem(page, merchant.id, menuItem.id)
    await page.getByTestId(`add-to-cart-${menuItem.id}`).click()
    await page.getByTestId('checkout-button').click()

    const form = page.getByTestId('order-form')
    await expect(form).toBeVisible()

    await form.locator('input').nth(0).fill('重复提交客户')
    await form.locator('input[type="tel"]').fill(customerPhone)
    await form.locator('textarea').fill('上海市浦东新区重复提交测试路 18 号')

    const submitButton = form.getByTestId('submit-order-button')
    await submitButton.dblclick()

    await expect
      .poll(async () => (await getOrdersByPhone(merchant.id, customerPhone)).length, {
        message: 'expected double submit to create only one order',
        timeout: POLL_TIMEOUT_MS,
      })
      .toBe(1)

    const orders = await getOrdersByPhone(merchant.id, customerPhone)
    expect(orders[0]).toMatchObject({
      status: 'pending',
      original_amount: 28,
      total_amount: 28,
    })
  })

  test('membership upgrade discount applies immediately on the current order', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 会员升级菜品',
      price: 20,
    })

    const seededCustomer = await createCustomerForMerchant({
      merchantId: merchant.id,
      phone: `138${Date.now().toString().slice(-8)}`,
      name: '会员升级顾客',
      address: '上海市浦东新区会员测试路 66 号',
      points: 90,
      orderCount: 2,
      totalSpent: 90,
    })

    await openMenuWithItem(page, merchant.id, menuItem.id)

    await page.getByTestId(`add-to-cart-${menuItem.id}`).click()
    await page.getByTestId('checkout-button').click()

    const form = page.getByTestId('order-form')
    await expect(form).toBeVisible()

    await form.locator('input').nth(0).fill('会员升级顾客')
    await form.locator('input[type="tel"]').fill(seededCustomer.phone!)
    await form.locator('textarea').fill('上海市浦东新区会员测试路 66 号')

    await expect(form.getByTestId('vip-info-trigger')).toContainText('LV1', { timeout: POLL_TIMEOUT_MS })
    await form.getByTestId('submit-order-button').click()

    await expect
      .poll(async () => findLatestOrderForPhone(merchant.id, seededCustomer.phone!), {
        message: 'expected the current order to use the upgraded membership discount',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        status: 'pending',
        original_amount: 20,
        total_amount: 19.6,
        vip_discount_rate: 0.98,
        vip_discount_amount: 0.4,
        coupon_discount_amount: 0,
      })

    await expect
      .poll(async () => getCustomerById(seededCustomer.id), {
        message: 'expected customer points and order stats to update after upgraded checkout',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        order_count: 3,
        points: 109,
      })

    const updatedCustomer = await getCustomerById(seededCustomer.id)
    expect(Number(updatedCustomer.total_spent)).toBe(109.6)
  })

  test('checkout uses the latest membership thresholds when merchant updates them before submission', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 会员门槛变更商品',
      price: 20,
    })

    const seededCustomer = await createCustomerForMerchant({
      merchantId: merchant.id,
      phone: `138${Date.now().toString().slice(-8)}`,
      name: '会员门槛变更客户',
      address: '上海市浦东新区会员门槛变更路 66 号',
      points: 90,
      orderCount: 2,
      totalSpent: 90,
    })

    await openMenuWithItem(page, merchant.id, menuItem.id)
    await page.getByTestId(`add-to-cart-${menuItem.id}`).click()
    await page.getByTestId('checkout-button').click()

    const form = page.getByTestId('order-form')
    await expect(form).toBeVisible()

    await form.locator('input').nth(0).fill('会员门槛变更客户')
    await form.locator('input[type="tel"]').fill(seededCustomer.phone!)
    await form.locator('textarea').fill('上海市浦东新区会员门槛变更路 66 号')

    await expect(form.getByTestId('vip-info-trigger')).toContainText('LV1', { timeout: POLL_TIMEOUT_MS })

    await updateMerchantAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      patch: {
        membership_levels: [
          { id: 'lv1', name: '铜牌会员', rate: 0.98, minPoints: 200, color: '#22c55e' },
          { id: 'lv2', name: '银牌会员', rate: 0.96, minPoints: 401, color: '#3b82f6' },
          { id: 'lv3', name: '金牌会员', rate: 0.94, minPoints: 801, color: '#8b5cf6' },
          { id: 'lv4', name: '铂金会员', rate: 0.92, minPoints: 1501, color: '#f59e0b' },
          { id: 'lv5', name: '钻石会员', rate: 0.9, minPoints: 3001, color: '#ef4444' },
        ],
      },
    })

    await form.getByTestId('submit-order-button').click()

    await expect
      .poll(async () => findLatestOrderForPhone(merchant.id, seededCustomer.phone!), {
        message: 'expected checkout submission to use the latest membership thresholds',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        status: 'pending',
        original_amount: 20,
        total_amount: 20,
        vip_discount_rate: 1,
        vip_discount_amount: 0,
      })

    await expect
      .poll(async () => getCustomerById(seededCustomer.id), {
        message: 'expected customer stats to be updated using the recalculated final amount',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        order_count: 3,
        points: 110,
      })

    const updatedCustomer = await getCustomerById(seededCustomer.id)
    expect(Number(updatedCustomer.total_spent)).toBe(110)
  })

  test('assigned unused coupon is applied and marked as used after checkout', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 优惠券下单菜品',
      price: 36,
    })

    const seededCustomer = await createCustomerForMerchant({
      merchantId: merchant.id,
      phone: `137${Date.now().toString().slice(-8)}`,
      name: '优惠券顾客',
      address: '上海市浦东新区优惠券测试路 88 号',
    })

    const { userCoupon } = await createUnusedCouponForCustomerAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      customerId: seededCustomer.id,
      amount: 8,
      minSpend: 0,
      title: 'E2E 8元券',
    })

    await openMenuWithItem(page, merchant.id, menuItem.id)

    await page.getByTestId(`add-to-cart-${menuItem.id}`).click()
    await page.getByTestId('checkout-button').click()

    const form = page.getByTestId('order-form')
    await expect(form).toBeVisible()

    await form.locator('input').nth(0).fill('优惠券顾客')
    await form.locator('input[type="tel"]').fill(seededCustomer.phone!)
    await form.locator('textarea').fill('上海市浦东新区优惠券测试路 88 号')

    await expect(form.getByTestId('coupon-trigger')).toContainText('8.00', { timeout: POLL_TIMEOUT_MS })
    await form.getByTestId('submit-order-button').click()

    await expect
      .poll(async () => findLatestOrderForPhone(merchant.id, seededCustomer.phone!), {
        message: 'expected checkout to apply the assigned coupon discount',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        status: 'pending',
        original_amount: 36,
        total_amount: 28,
        coupon_discount_amount: 8,
        vip_discount_amount: 0,
      })

    await expect
      .poll(async () => getUserCouponById(userCoupon.id), {
        message: 'expected assigned coupon to become used after checkout',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        status: 'used',
      })
  })

  test('concurrent checkout only consumes an assigned coupon once', async ({ browser }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 并发用券商品',
      price: 36,
    })

    const seededCustomer = await createCustomerForMerchant({
      merchantId: merchant.id,
      phone: `136${Date.now().toString().slice(-8)}`,
      name: '并发用券顾客',
      address: '上海市浦东新区并发用券路 18 号',
    })

    const { userCoupon } = await createUnusedCouponForCustomerAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      customerId: seededCustomer.id,
      amount: 8,
      minSpend: 0,
      title: 'E2E 并发用券 8 元券',
    })

    const [contextA, contextB] = await Promise.all([browser.newContext(), browser.newContext()])
    const [pageA, pageB] = await Promise.all([contextA.newPage(), contextB.newPage()])

    try {
      await Promise.all([
        openCheckoutForItem({ page: pageA, merchantId: merchant.id, itemId: menuItem.id }),
        openCheckoutForItem({ page: pageB, merchantId: merchant.id, itemId: menuItem.id }),
      ])

      await Promise.all([
        fillCheckoutForm({
          page: pageA,
          customerName: '并发用券顾客',
          phone: seededCustomer.phone!,
          address: '上海市浦东新区并发用券路 18 号',
        }),
        fillCheckoutForm({
          page: pageB,
          customerName: '并发用券顾客',
          phone: seededCustomer.phone!,
          address: '上海市浦东新区并发用券路 18 号',
        }),
      ])

      await Promise.all([
        expect(pageA.getByTestId('coupon-trigger')).toContainText('8.00', { timeout: POLL_TIMEOUT_MS }),
        expect(pageB.getByTestId('coupon-trigger')).toContainText('8.00', { timeout: POLL_TIMEOUT_MS }),
      ])

      await Promise.all([
        pageA.getByTestId('submit-order-button').click(),
        pageB.getByTestId('submit-order-button').click(),
      ])

      await expect
        .poll(async () => getOrdersByPhone(merchant.id, seededCustomer.phone!), {
          message: 'expected concurrent checkout to create exactly one discounted order',
          timeout: POLL_TIMEOUT_MS,
        })
        .toHaveLength(1)

      const createdOrders = await getOrdersByPhone(merchant.id, seededCustomer.phone!)
      expect(createdOrders[0]).toMatchObject({
        original_amount: 36,
        total_amount: 28,
        coupon_discount_amount: 8,
      })

      await expect
        .poll(async () => getUserCouponById(userCoupon.id), {
          message: 'expected concurrent checkout to leave the coupon consumed exactly once',
          timeout: POLL_TIMEOUT_MS,
        })
        .toMatchObject({
          status: 'used',
        })
    } finally {
      await Promise.all([contextA.close(), contextB.close()])
    }
  })

  test('failed order_items insert rolls back order and coupon state', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 下单回滚商品',
      price: 34,
    })

    const seededCustomer = await createCustomerForMerchant({
      merchantId: merchant.id,
      phone: `135${Date.now().toString().slice(-8)}`,
      name: '下单回滚顾客',
      address: '上海市浦东新区回滚测试路 88 号',
    })

    const { userCoupon } = await createUnusedCouponForCustomerAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      customerId: seededCustomer.id,
      amount: 6,
      minSpend: 0,
      title: 'E2E 回滚券',
    })

    await page.route('**/rest/v1/order_items*', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'forced order_items failure' }),
        })
        return
      }

      await route.continue()
    })

    await openCheckoutForItem({ page, merchantId: merchant.id, itemId: menuItem.id })
    await fillCheckoutForm({
      page,
      customerName: '下单回滚顾客',
      phone: seededCustomer.phone!,
      address: '上海市浦东新区回滚测试路 88 号',
    })

    await expect(page.getByTestId('coupon-trigger')).toContainText('6.00', { timeout: POLL_TIMEOUT_MS })
    await page.getByTestId('submit-order-button').click()

    await expect
      .poll(async () => getOrdersByPhone(merchant.id, seededCustomer.phone!), {
        message: 'expected failed order_items insert to leave no order behind',
        timeout: POLL_TIMEOUT_MS,
      })
      .toHaveLength(0)

    await expect
      .poll(async () => getUserCouponById(userCoupon.id), {
        message: 'expected rollback to restore the reserved coupon',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        status: 'unused',
      })

    await expect
      .poll(async () => getCustomerById(seededCustomer.id), {
        message: 'expected rollback to restore customer stats after order_items failure',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        order_count: 0,
        points: 0,
      })

    await expect
      .poll(async () => Number((await getCustomerById(seededCustomer.id)).total_spent), {
        message: 'expected rollback to restore customer total_spent after order_items failure',
        timeout: POLL_TIMEOUT_MS,
      })
      .toBe(0)
  })

  test('failed order insert rolls back customer stats and coupon state', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 订单插入失败商品',
      price: 34,
    })

    const seededCustomer = await createCustomerForMerchant({
      merchantId: merchant.id,
      phone: `135${Date.now().toString().slice(-8)}`,
      name: '订单插入失败顾客',
      address: '上海市浦东新区订单插入失败测试路 108 号',
    })

    const { userCoupon } = await createUnusedCouponForCustomerAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      customerId: seededCustomer.id,
      amount: 6,
      minSpend: 0,
      title: 'E2E 订单插入失败券',
    })

    await page.route('**/rest/v1/orders*', async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'forced orders failure' }),
        })
        return
      }

      await route.continue()
    })

    await openCheckoutForItem({ page, merchantId: merchant.id, itemId: menuItem.id })
    await fillCheckoutForm({
      page,
      customerName: '订单插入失败顾客',
      phone: seededCustomer.phone!,
      address: '上海市浦东新区订单插入失败测试路 108 号',
    })

    await expect(page.getByTestId('coupon-trigger')).toContainText('6.00', { timeout: POLL_TIMEOUT_MS })
    await page.getByTestId('submit-order-button').click()

    await expect
      .poll(async () => getOrdersByPhone(merchant.id, seededCustomer.phone!), {
        message: 'expected failed orders insert to leave no order behind',
        timeout: POLL_TIMEOUT_MS,
      })
      .toHaveLength(0)

    await expect
      .poll(async () => getUserCouponById(userCoupon.id), {
        message: 'expected failed orders insert to restore the reserved coupon',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        status: 'unused',
      })

    await expect
      .poll(async () => getCustomerById(seededCustomer.id), {
        message: 'expected failed orders insert to preserve customer stats',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        order_count: 0,
        points: 0,
      })

    await expect
      .poll(async () => Number((await getCustomerById(seededCustomer.id)).total_spent), {
        message: 'expected failed orders insert to preserve customer total_spent',
        timeout: POLL_TIMEOUT_MS,
      })
      .toBe(0)
  })

  test('failed existing customer update blocks checkout before creating order or consuming coupon', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 顾客更新失败商品',
      price: 34,
    })

    const seededCustomer = await createCustomerForMerchant({
      merchantId: merchant.id,
      phone: `135${Date.now().toString().slice(-8)}`,
      name: '顾客更新失败顾客',
      address: '上海市浦东新区顾客更新失败测试路 118 号',
    })

    const { userCoupon } = await createUnusedCouponForCustomerAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      customerId: seededCustomer.id,
      amount: 6,
      minSpend: 0,
      title: 'E2E 顾客更新失败券',
    })

    await page.route('**/rest/v1/customers*', async (route) => {
      const request = route.request()
      if (request.method() === 'PATCH') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'forced customers update failure' }),
        })
        return
      }

      await route.continue()
    })

    await openCheckoutForItem({ page, merchantId: merchant.id, itemId: menuItem.id })
    await fillCheckoutForm({
      page,
      customerName: '顾客更新失败顾客',
      phone: seededCustomer.phone!,
      address: '上海市浦东新区顾客更新失败测试路 118 号',
    })

    await expect(page.getByTestId('coupon-trigger')).toContainText('6.00', { timeout: POLL_TIMEOUT_MS })
    await page.getByTestId('submit-order-button').click()

    await expect
      .poll(async () => getOrdersByPhone(merchant.id, seededCustomer.phone!), {
        message: 'expected failed customer update to block order creation',
        timeout: POLL_TIMEOUT_MS,
      })
      .toHaveLength(0)

    await expect
      .poll(async () => getUserCouponById(userCoupon.id), {
        message: 'expected failed customer update to keep coupon unused',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        status: 'unused',
      })

    await expect
      .poll(async () => getCustomerById(seededCustomer.id), {
        message: 'expected failed customer update to preserve existing customer stats',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        order_count: 0,
        points: 0,
      })

    await expect
      .poll(async () => Number((await getCustomerById(seededCustomer.id)).total_spent), {
        message: 'expected failed customer update to preserve existing customer total_spent',
        timeout: POLL_TIMEOUT_MS,
      })
      .toBe(0)
  })

  test('failed new customer insert blocks checkout before creating any order', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 新顾客创建失败商品',
      price: 32,
    })

    const phone = `136${Date.now().toString().slice(-8)}`

    await page.route('**/rest/v1/customers*', async (route) => {
      const request = route.request()
      if (request.method() === 'POST') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'forced customers insert failure' }),
        })
        return
      }

      await route.continue()
    })

    await openCheckoutForItem({ page, merchantId: merchant.id, itemId: menuItem.id })
    await fillCheckoutForm({
      page,
      customerName: '新顾客创建失败顾客',
      phone,
      address: '上海市浦东新区新顾客创建失败测试路 128 号',
    })

    await page.getByTestId('submit-order-button').click()

    await expect
      .poll(async () => getOrdersByPhone(merchant.id, phone), {
        message: 'expected failed customer insert to leave no order behind',
        timeout: POLL_TIMEOUT_MS,
      })
      .toHaveLength(0)

    await expect
      .poll(async () => findCustomerByPhone(merchant.id, phone), {
        message: 'expected failed customer insert to leave no customer behind',
        timeout: POLL_TIMEOUT_MS,
      })
      .toBeNull()
  })

  test('failed coupon reservation blocks checkout before creating order or mutating customer stats', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 优惠券预占失败商品',
      price: 34,
    })

    const seededCustomer = await createCustomerForMerchant({
      merchantId: merchant.id,
      phone: `135${Date.now().toString().slice(-8)}`,
      name: '优惠券预占失败顾客',
      address: '上海市浦东新区优惠券预占失败测试路 138 号',
    })

    const { userCoupon } = await createUnusedCouponForCustomerAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      customerId: seededCustomer.id,
      amount: 6,
      minSpend: 0,
      title: 'E2E 优惠券预占失败券',
    })

    await page.route('**/rest/v1/user_coupons*', async (route) => {
      const request = route.request()
      if (request.method() === 'PATCH') {
        await route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'forced user_coupons reservation failure' }),
        })
        return
      }

      await route.continue()
    })

    await openCheckoutForItem({ page, merchantId: merchant.id, itemId: menuItem.id })
    await fillCheckoutForm({
      page,
      customerName: '优惠券预占失败顾客',
      phone: seededCustomer.phone!,
      address: '上海市浦东新区优惠券预占失败测试路 138 号',
    })

    await expect(page.getByTestId('coupon-trigger')).toContainText('6.00', { timeout: POLL_TIMEOUT_MS })
    await page.getByTestId('submit-order-button').click()

    await expect
      .poll(async () => getOrdersByPhone(merchant.id, seededCustomer.phone!), {
        message: 'expected failed coupon reservation to block order creation',
        timeout: POLL_TIMEOUT_MS,
      })
      .toHaveLength(0)

    await expect
      .poll(async () => getUserCouponById(userCoupon.id), {
        message: 'expected failed coupon reservation to keep coupon unused',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        status: 'unused',
      })

    await expect
      .poll(async () => getCustomerById(seededCustomer.id), {
        message: 'expected failed coupon reservation to preserve customer stats',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        order_count: 0,
        points: 0,
      })

    await expect
      .poll(async () => Number((await getCustomerById(seededCustomer.id)).total_spent), {
        message: 'expected failed coupon reservation to preserve customer total_spent',
        timeout: POLL_TIMEOUT_MS,
      })
      .toBe(0)
  })

  test('expired coupon is ignored and stays unused', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 过期券测试商品',
      price: 30,
    })

    const seededCustomer = await createCustomerForMerchant({
      merchantId: merchant.id,
      phone: `138${Date.now().toString().slice(-8)}`,
      name: '过期券客户',
      address: '上海市浦东新区过期券测试路 66 号',
    })

    const { userCoupon: expiredCoupon } = await createUnusedCouponForCustomerAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      customerId: seededCustomer.id,
      amount: 10,
      minSpend: 0,
      title: 'E2E 已过期券',
      expiresAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    })

    await openMenuWithItem(page, merchant.id, menuItem.id)
    await page.getByTestId(`add-to-cart-${menuItem.id}`).click()
    await page.getByTestId('checkout-button').click()

    const form = page.getByTestId('order-form')
    await form.locator('input').nth(0).fill('过期券客户')
    await form.locator('input[type="tel"]').fill(seededCustomer.phone!)
    await form.locator('textarea').fill('上海市浦东新区过期券测试路 66 号')

    await expect(form.getByTestId('coupon-trigger')).toHaveCount(0)
    await form.getByTestId('submit-order-button').click()

    await expect
      .poll(async () => findLatestOrderForPhone(merchant.id, seededCustomer.phone!), {
        message: 'expected checkout to ignore expired coupon',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        coupon_discount_amount: 0,
      })

    await expect(await getUserCouponById(expiredCoupon.id)).toMatchObject({
      status: 'unused',
    })
  })

  test('empty address blocks checkout submission', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 地址校验商品',
      price: 24,
    })

    const phone = `136${Date.now().toString().slice(-8)}`
    let orderInsertCount = 0

    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/rest/v1/orders')) {
        orderInsertCount += 1
      }
    })

    await openMenuWithItem(page, merchant.id, menuItem.id)
    await page.getByTestId(`add-to-cart-${menuItem.id}`).click()
    await page.getByTestId('checkout-button').click()

    const form = page.getByTestId('order-form')
    await expect(form).toBeVisible()

    await form.locator('input').nth(0).fill('地址校验客户')
    await form.locator('input[type="tel"]').fill(phone)
    await form.locator('textarea').fill('')
    await form.getByTestId('submit-order-button').click()

    await expect(form.locator('textarea')).toHaveAttribute('aria-invalid', 'true')
    await expect.poll(() => orderInsertCount, { timeout: 5_000 }).toBe(0)
    await expect.poll(async () => findLatestOrderForPhone(merchant.id, phone), { timeout: 3_000 }).toBeNull()
  })

  test('invalid phone blocks checkout submission', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 手机号校验商品',
      price: 26,
    })

    let orderInsertCount = 0

    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/rest/v1/orders')) {
        orderInsertCount += 1
      }
    })

    await openMenuWithItem(page, merchant.id, menuItem.id)
    await page.getByTestId(`add-to-cart-${menuItem.id}`).click()
    await page.getByTestId('checkout-button').click()

    const form = page.getByTestId('order-form')
    await expect(form).toBeVisible()

    await form.locator('input').nth(0).fill('手机号校验客户')
    await form.locator('input[type="tel"]').fill('12345678901')
    await form.locator('textarea').fill('上海市浦东新区手机号校验路 18 号')
    await form.getByTestId('submit-order-button').click()

    await expect(form.locator('input[type="tel"]')).toHaveAttribute('aria-invalid', 'true')
    await expect.poll(() => orderInsertCount, { timeout: 5_000 }).toBe(0)
  })

  test('empty customer name blocks checkout submission', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 姓名校验商品',
      price: 22,
    })

    const phone = `135${Date.now().toString().slice(-8)}`
    let orderInsertCount = 0

    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/rest/v1/orders')) {
        orderInsertCount += 1
      }
    })

    await openMenuWithItem(page, merchant.id, menuItem.id)
    await page.getByTestId(`add-to-cart-${menuItem.id}`).click()
    await page.getByTestId('checkout-button').click()

    const form = page.getByTestId('order-form')
    await expect(form).toBeVisible()

    await form.locator('input').nth(0).fill('')
    await form.locator('input[type="tel"]').fill(phone)
    await form.locator('textarea').fill('上海市浦东新区姓名校验路 88 号')
    await form.getByTestId('submit-order-button').click()

    await expect(form.locator('input').nth(0)).toHaveAttribute('aria-invalid', 'true')
    await expect.poll(() => orderInsertCount, { timeout: 5_000 }).toBe(0)
    await expect.poll(async () => findLatestOrderForPhone(merchant.id, phone), { timeout: 3_000 }).toBeNull()
  })

  test('checkout is blocked if the merchant pauses orders before submission', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 结算中暂停接单商品',
      price: 32,
    })

    const phone = `131${Date.now().toString().slice(-8)}`
    let orderInsertCount = 0

    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/rest/v1/orders')) {
        orderInsertCount += 1
      }
    })

    await openMenuWithItem(page, merchant.id, menuItem.id)
    await page.getByTestId(`add-to-cart-${menuItem.id}`).click()
    await page.getByTestId('checkout-button').click()

    const form = page.getByTestId('order-form')
    await expect(form).toBeVisible()

    await form.locator('input').nth(0).fill('暂停接单拦截客户')
    await form.locator('input[type="tel"]').fill(phone)
    await form.locator('textarea').fill('上海市浦东新区暂停接单测试路 108 号')

    await updateMerchantAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      patch: {
        is_accepting_orders: false,
        announcement: '商家临时停止接单',
      },
    })

    await form.getByTestId('submit-order-button').click()

    await expect(page.getByTestId('store-closed-message')).toHaveText('商家临时停止接单', { timeout: 5_000 })
    await expect.poll(() => orderInsertCount, { timeout: 5_000 }).toBe(0)
    await expect.poll(async () => findLatestOrderForPhone(merchant.id, phone), { timeout: 3_000 }).toBeNull()
  })

  test('checkout is blocked if business hours change and invalidate the selected time', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 营业时间变更拦截商品',
      price: 34,
    })

    const phone = `130${Date.now().toString().slice(-8)}`
    let orderInsertCount = 0

    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/rest/v1/orders')) {
        orderInsertCount += 1
      }
    })

    await openMenuWithItem(page, merchant.id, menuItem.id)
    await page.getByTestId(`add-to-cart-${menuItem.id}`).click()
    await page.getByTestId('checkout-button').click()

    const form = page.getByTestId('order-form')
    await expect(form).toBeVisible()

    await form.locator('input').nth(0).fill('营业时间变更拦截客户')
    await form.locator('input[type="tel"]').fill(phone)
    await form.locator('textarea').fill('上海市浦东新区营业时间变更测试路 208 号')

    await updateMerchantAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      patch: {
        business_hours: {
          is_enabled: true,
          open_time: '00:00',
          close_time: '00:01',
        },
      },
    })

    await form.getByTestId('submit-order-button').click()

    await expect(page.getByText('所选时间不在营业时段内（00:00 - 00:01）')).toBeVisible({ timeout: 5_000 })
    await expect.poll(() => orderInsertCount, { timeout: 5_000 }).toBe(0)
    await expect.poll(async () => findLatestOrderForPhone(merchant.id, phone), { timeout: 3_000 }).toBeNull()
  })

  test('checkout is blocked if the selected date becomes a disabled date before submission', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 结算中停业日变化商品',
      price: 33,
    })

    const phone = `136${Date.now().toString().slice(-8)}`
    let orderInsertCount = 0

    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/rest/v1/orders')) {
        orderInsertCount += 1
      }
    })

    await openMenuWithItem(page, merchant.id, menuItem.id)
    await page.getByTestId(`add-to-cart-${menuItem.id}`).click()
    await page.getByTestId('checkout-button').click()

    const form = page.getByTestId('order-form')
    await expect(form).toBeVisible()

    await form.locator('input').nth(0).fill('停业日变化拦截客户')
    await form.locator('input[type="tel"]').fill(phone)
    await form.locator('textarea').fill('上海市浦东新区停业日变化测试路 118 号')

    const scheduledDate = getDefaultScheduledDateInShanghai()

    await createDisabledDateAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      disabledDate: scheduledDate,
      reason: '商家临时休息',
    })

    await form.getByTestId('submit-order-button').click()

    await expect(page.getByTestId('store-closed-message')).toHaveText('商家临时休息', { timeout: 5_000 })
    await expect.poll(() => orderInsertCount, { timeout: 5_000 }).toBe(0)
    await expect.poll(async () => findLatestOrderForPhone(merchant.id, phone), { timeout: 3_000 }).toBeNull()
  })

  test('checkout still respects the latest disabled date after the merchant resumes accepting orders', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 组合营业规则拦截商品',
      price: 35,
    })

    const phone = `137${Date.now().toString().slice(-8)}`
    let orderInsertCount = 0

    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/rest/v1/orders')) {
        orderInsertCount += 1
      }
    })

    await openMenuWithItem(page, merchant.id, menuItem.id)
    await page.getByTestId(`add-to-cart-${menuItem.id}`).click()
    await page.getByTestId('checkout-button').click()

    const form = page.getByTestId('order-form')
    await expect(form).toBeVisible()

    await form.locator('input').nth(0).fill('组合规则动态校验客户')
    await form.locator('input[type="tel"]').fill(phone)
    await form.locator('textarea').fill('上海市浦东新区组合规则测试路 128 号')

    await updateMerchantAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      patch: {
        is_accepting_orders: false,
        announcement: '临时暂停接单',
      },
    })

    await createDisabledDateAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      disabledDate: getDefaultScheduledDateInShanghai(),
      reason: '恢复营业后仍然店休',
    })

    await updateMerchantAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      patch: {
        is_accepting_orders: true,
      },
    })

    await form.getByTestId('submit-order-button').click()

    await expect(page.getByTestId('store-closed-message')).toHaveText('恢复营业后仍然店休', { timeout: 5_000 })
    await expect.poll(() => orderInsertCount, { timeout: 5_000 }).toBe(0)
    await expect.poll(async () => findLatestOrderForPhone(merchant.id, phone), { timeout: 3_000 }).toBeNull()
  })

  test('checkout is blocked if the selected coupon is disabled before submission', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 结算中优惠券失效商品',
      price: 36,
    })

    const seededCustomer = await createCustomerForMerchant({
      merchantId: merchant.id,
      phone: `132${Date.now().toString().slice(-8)}`,
      name: '优惠券失效拦截客户',
      address: '上海市浦东新区优惠券失效测试路 306 号',
    })

    const { userCoupon, coupon } = await createUnusedCouponForCustomerAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      customerId: seededCustomer.id,
      amount: 8,
      minSpend: 0,
      title: 'E2E 结算中失效券',
    })

    let orderInsertCount = 0
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/rest/v1/orders')) {
        orderInsertCount += 1
      }
    })

    await openMenuWithItem(page, merchant.id, menuItem.id)
    await page.getByTestId(`add-to-cart-${menuItem.id}`).click()
    await page.getByTestId('checkout-button').click()

    const form = page.getByTestId('order-form')
    await expect(form).toBeVisible()

    await form.locator('input').nth(0).fill('优惠券失效拦截客户')
    await form.locator('input[type="tel"]').fill(seededCustomer.phone!)
    await form.locator('textarea').fill('上海市浦东新区优惠券失效测试路 306 号')
    await expect(form.getByTestId('coupon-trigger')).toContainText('8.00', { timeout: POLL_TIMEOUT_MS })

    await updateCouponAsMerchant({
      couponId: coupon.id,
      merchantPhone,
      merchantPassword,
      patch: {
        status: 'disabled',
      },
    })

    await form.getByTestId('submit-order-button').click()

    await expect(page.getByText('所选优惠券已失效，请重新确认订单金额')).toBeVisible({ timeout: 5_000 })
    await expect.poll(() => orderInsertCount, { timeout: 5_000 }).toBe(0)
    await expect.poll(async () => findLatestOrderForPhone(merchant.id, seededCustomer.phone!), { timeout: 3_000 }).toBeNull()
    await expect(await getUserCouponById(userCoupon.id)).toMatchObject({ status: 'unused' })
  })

  test('checkout is blocked if the selected coupon no longer meets the updated rule before submission', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 结算中门槛变化商品',
      price: 36,
    })

    const seededCustomer = await createCustomerForMerchant({
      merchantId: merchant.id,
      phone: `131${Date.now().toString().slice(-8)}`,
      name: '优惠门槛变化拦截客户',
      address: '上海市浦东新区优惠门槛变化路 406 号',
    })

    const { userCoupon, coupon } = await createUnusedCouponForCustomerAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      customerId: seededCustomer.id,
      amount: 8,
      minSpend: 0,
      title: 'E2E 结算中改门槛券',
    })

    let orderInsertCount = 0
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/rest/v1/orders')) {
        orderInsertCount += 1
      }
    })

    await openMenuWithItem(page, merchant.id, menuItem.id)
    await page.getByTestId(`add-to-cart-${menuItem.id}`).click()
    await page.getByTestId('checkout-button').click()

    const form = page.getByTestId('order-form')
    await expect(form).toBeVisible()

    await form.locator('input').nth(0).fill('优惠门槛变化拦截客户')
    await form.locator('input[type="tel"]').fill(seededCustomer.phone!)
    await form.locator('textarea').fill('上海市浦东新区优惠门槛变化路 406 号')
    await expect(form.getByTestId('coupon-trigger')).toContainText('8.00', { timeout: POLL_TIMEOUT_MS })

    await updateCouponAsMerchant({
      couponId: coupon.id,
      merchantPhone,
      merchantPassword,
      patch: {
        min_spend: 100,
      },
    })

    await form.getByTestId('submit-order-button').click()

    await expect(page.getByText('所选优惠券已失效，请重新确认订单金额')).toBeVisible({ timeout: 5_000 })
    await expect.poll(() => orderInsertCount, { timeout: 5_000 }).toBe(0)
    await expect.poll(async () => findLatestOrderForPhone(merchant.id, seededCustomer.phone!), { timeout: 3_000 }).toBeNull()
    await expect(await getUserCouponById(userCoupon.id)).toMatchObject({ status: 'unused' })
  })

  test('checkout is blocked if the selected coupon amount changes before submission', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 结算中券面额变化商品',
      price: 36,
    })

    const seededCustomer = await createCustomerForMerchant({
      merchantId: merchant.id,
      phone: `130${Date.now().toString().slice(-8)}`,
      name: '优惠面额变化拦截客户',
      address: '上海市浦东新区优惠面额变化路 506 号',
    })

    const { userCoupon, coupon } = await createUnusedCouponForCustomerAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      customerId: seededCustomer.id,
      amount: 8,
      minSpend: 0,
      title: 'E2E 结算中改面额券',
    })

    let orderInsertCount = 0
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/rest/v1/orders')) {
        orderInsertCount += 1
      }
    })

    await openMenuWithItem(page, merchant.id, menuItem.id)
    await page.getByTestId(`add-to-cart-${menuItem.id}`).click()
    await page.getByTestId('checkout-button').click()

    const form = page.getByTestId('order-form')
    await expect(form).toBeVisible()

    await form.locator('input').nth(0).fill('优惠面额变化拦截客户')
    await form.locator('input[type="tel"]').fill(seededCustomer.phone!)
    await form.locator('textarea').fill('上海市浦东新区优惠面额变化路 506 号')
    await expect(form.getByTestId('coupon-trigger')).toContainText('8.00', { timeout: POLL_TIMEOUT_MS })

    await updateCouponAsMerchant({
      couponId: coupon.id,
      merchantPhone,
      merchantPassword,
      patch: {
        amount: 5,
      },
    })

    await form.getByTestId('submit-order-button').click()

    await expect(page.getByText('所选优惠券已失效，请重新确认订单金额')).toBeVisible({ timeout: 5_000 })
    await expect.poll(() => orderInsertCount, { timeout: 5_000 }).toBe(0)
    await expect.poll(async () => findLatestOrderForPhone(merchant.id, seededCustomer.phone!), { timeout: 3_000 }).toBeNull()
    await expect(await getUserCouponById(userCoupon.id)).toMatchObject({ status: 'unused' })
  })

  test('checkout is blocked if the selected coupon is retargeted away from the current cart before submission', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 结算中目标商品变化当前商品',
      price: 36,
    })
    const { menuItem: otherMenuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 结算中目标商品变化其他商品',
      price: 18,
    })

    const seededCustomer = await createCustomerForMerchant({
      merchantId: merchant.id,
      phone: `139${Date.now().toString().slice(-8)}`,
      name: '优惠目标变化拦截客户',
      address: '上海市浦东新区优惠目标变化路 606 号',
    })

    const { userCoupon, coupon } = await createUnusedCouponForCustomerAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      customerId: seededCustomer.id,
      amount: 8,
      minSpend: 0,
      title: 'E2E 结算中改目标券',
      targetType: 'category',
      targetItemIds: [menuItem.id],
    })

    let orderInsertCount = 0
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/rest/v1/orders')) {
        orderInsertCount += 1
      }
    })

    await openMenuWithItem(page, merchant.id, menuItem.id)
    await page.getByTestId(`add-to-cart-${menuItem.id}`).click()
    await page.getByTestId('checkout-button').click()

    const form = page.getByTestId('order-form')
    await expect(form).toBeVisible()

    await form.locator('input').nth(0).fill('优惠目标变化拦截客户')
    await form.locator('input[type="tel"]').fill(seededCustomer.phone!)
    await form.locator('textarea').fill('上海市浦东新区优惠目标变化路 606 号')
    await expect(form.getByTestId('coupon-trigger')).toContainText('8.00', { timeout: POLL_TIMEOUT_MS })

    await updateCouponAsMerchant({
      couponId: coupon.id,
      merchantPhone,
      merchantPassword,
      patch: {
        target_item_ids: [otherMenuItem.id],
      },
    })

    await form.getByTestId('submit-order-button').click()

    await expect(page.getByText('所选优惠券已失效，请重新确认订单金额')).toBeVisible({ timeout: 5_000 })
    await expect.poll(() => orderInsertCount, { timeout: 5_000 }).toBe(0)
    await expect.poll(async () => findLatestOrderForPhone(merchant.id, seededCustomer.phone!), { timeout: 3_000 }).toBeNull()
    await expect(await getUserCouponById(userCoupon.id)).toMatchObject({ status: 'unused' })
  })

  test('checkout is blocked if the selected category coupon is retargeted to another category before submission', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { category: currentCategory, menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 结算中目标分类变化当前商品',
      price: 36,
    })
    const otherCategory = await createCategoryForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      categoryName: `E2E 其他目标分类${Date.now().toString().slice(-4)}`,
    })

    const seededCustomer = await createCustomerForMerchant({
      merchantId: merchant.id,
      phone: `138${Date.now().toString().slice(-8)}`,
      name: '优惠分类变化拦截客户',
      address: '上海市浦东新区优惠分类变化路 706 号',
    })

    const { userCoupon, coupon } = await createUnusedCouponForCustomerAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      customerId: seededCustomer.id,
      amount: 8,
      minSpend: 0,
      title: 'E2E 结算中改目标分类券',
      targetType: 'category',
      targetCategoryId: currentCategory.id,
    })

    let orderInsertCount = 0
    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/rest/v1/orders')) {
        orderInsertCount += 1
      }
    })

    await openMenuWithItem(page, merchant.id, menuItem.id)
    await page.getByTestId(`add-to-cart-${menuItem.id}`).click()
    await page.getByTestId('checkout-button').click()

    const form = page.getByTestId('order-form')
    await expect(form).toBeVisible()

    await form.locator('input').nth(0).fill('优惠分类变化拦截客户')
    await form.locator('input[type="tel"]').fill(seededCustomer.phone!)
    await form.locator('textarea').fill('上海市浦东新区优惠分类变化路 706 号')
    await expect(form.getByTestId('coupon-trigger')).toContainText('8.00', { timeout: POLL_TIMEOUT_MS })

    await updateCouponAsMerchant({
      couponId: coupon.id,
      merchantPhone,
      merchantPassword,
      patch: {
        target_category_id: otherCategory.id,
        target_item_ids: [],
      },
    })

    await form.getByTestId('submit-order-button').click()

    await expect(page.getByText('所选优惠券已失效，请重新确认订单金额')).toBeVisible({ timeout: 5_000 })
    await expect.poll(() => orderInsertCount, { timeout: 5_000 }).toBe(0)
    await expect.poll(async () => findLatestOrderForPhone(merchant.id, seededCustomer.phone!), { timeout: 3_000 }).toBeNull()
    await expect(await getUserCouponById(userCoupon.id)).toMatchObject({ status: 'unused' })
  })

  test('cart item is removed when quantity is decremented to zero from the cart modal', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 购物车减到零',
      price: 18,
    })

    await openMenuWithItem(page, merchant.id, menuItem.id)

    await page.getByTestId(`add-to-cart-${menuItem.id}`).click()
    await expect(page.getByTestId('checkout-button')).toBeVisible()

    await page.getByTestId('cart-bag-button').click()
    await expect(page.getByTestId(`cart-item-${menuItem.id}`)).toBeVisible()

    await page.getByTestId(`cart-remove-${menuItem.id}`).click()

    await expect(page.getByTestId(`cart-item-${menuItem.id}`)).toHaveCount(0)
    await expect(page.getByTestId('checkout-button')).toHaveCount(0)
  })

  test('clear cart empties the cart modal and hides the checkout bar', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 清空购物车',
      price: 21,
    })

    await openMenuWithItem(page, merchant.id, menuItem.id)

    await page.getByTestId(`add-to-cart-${menuItem.id}`).click()
    await page.getByTestId(`add-to-cart-${menuItem.id}`).click()
    await expect(page.getByTestId('checkout-button')).toBeVisible()

    await page.getByTestId('cart-bag-button').click()
    await expect(page.getByTestId(`cart-quantity-${menuItem.id}`)).toHaveText('2')
    await expect(page.getByTestId('cart-total-amount')).toContainText('42.00')

    await page.getByTestId('clear-cart-button').click()

    await expect(page.getByTestId(`cart-item-${menuItem.id}`)).toHaveCount(0)
    await expect(page.getByTestId('checkout-button')).toHaveCount(0)
  })

  test('newcomer login auto-claims reward coupon and uses it on the first order', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 新人首单菜品',
      price: 30,
    })

    const newcomerCoupon = await createCouponAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      title: 'E2E 新人5元券',
      amount: 5,
      minSpend: 0,
      isNewcomerReward: true,
    })

    const phone = createUniquePhone()

    await openMenuWithItem(page, merchant.id, menuItem.id)

    await page.getByTestId(`add-to-cart-${menuItem.id}`).click()
    await page.getByTestId('checkout-button').click()

    await expect(page.getByTestId('checkout-login-button')).toBeVisible({ timeout: POLL_TIMEOUT_MS })
    await page.getByTestId('checkout-login-button').click()
    await page.getByTestId('login-phone-input').fill(phone)
    await page.getByTestId('login-submit-button').click()

    await expect
      .poll(async () => findCustomerByPhone(merchant.id, phone), {
        message: 'expected newcomer login to create the customer account',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        phone,
        order_count: 0,
        points: 0,
      })

    const customer = await getCustomerByPhone(merchant.id, phone)

    await page.getByTestId('checkout-button').click()
    const form = page.getByTestId('order-form')
    await expect(form).toBeVisible()

    await form.locator('input').nth(0).fill('新人顾客')
    await form.locator('textarea').fill('上海市浦东新区新人测试路 99 号')

    await expect(form.getByTestId('coupon-trigger')).toContainText('5.00', { timeout: POLL_TIMEOUT_MS })
    await form.getByTestId('submit-order-button').click()

    await expect
      .poll(async () => findLatestOrderForPhone(merchant.id, phone), {
        message: 'expected newcomer reward coupon to be used on the first order',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        status: 'pending',
        original_amount: 30,
        total_amount: 25,
        coupon_discount_amount: 5,
      })

    await expect
      .poll(async () => getUserCouponsByCustomer(customer.id), {
        message: 'expected newcomer login to auto-claim a reward coupon for the customer',
        timeout: POLL_TIMEOUT_MS,
      })
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            coupon_id: newcomerCoupon.id,
            status: 'used',
          }),
        ]),
      )
  })

  test('newcomer reward auto-claim stays idempotent across relogin', async ({ browser }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 新人重登商品',
      price: 26,
    })

    const newcomerCoupon = await createCouponAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      title: 'E2E 新人重登券',
      amount: 5,
      minSpend: 0,
      isNewcomerReward: true,
    })

    const phone = createUniquePhone()
    const [contextA, contextB] = await Promise.all([browser.newContext(), browser.newContext()])
    const [pageA, pageB] = await Promise.all([contextA.newPage(), contextB.newPage()])

    try {
      await openMenuWithItem(pageA, merchant.id, menuItem.id)
      await pageA.getByTestId(`add-to-cart-${menuItem.id}`).click()
      await pageA.getByTestId('checkout-button').click()
      await pageA.getByTestId('checkout-login-button').click()
      await pageA.getByTestId('login-phone-input').fill(phone)
      await pageA.getByTestId('login-submit-button').click()

      await expect
        .poll(async () => findCustomerByPhone(merchant.id, phone), {
          message: 'expected newcomer login to create the customer once',
          timeout: POLL_TIMEOUT_MS,
        })
        .toMatchObject({
          phone,
          order_count: 0,
          points: 0,
        })

      const createdCustomer = await getCustomerByPhone(merchant.id, phone)

      await expect
        .poll(async () => getUserCouponsByCustomer(createdCustomer.id), {
          message: 'expected first newcomer login to auto-claim one reward coupon',
          timeout: POLL_TIMEOUT_MS,
        })
        .toEqual([
          expect.objectContaining({
            coupon_id: newcomerCoupon.id,
            status: 'unused',
          }),
        ])

      await openMenuWithItem(pageB, merchant.id, menuItem.id)
      await pageB.getByTestId(`add-to-cart-${menuItem.id}`).click()
      await pageB.getByTestId('checkout-button').click()
      await pageB.getByTestId('checkout-login-button').click()
      await pageB.getByTestId('login-phone-input').fill(phone)
      await pageB.getByTestId('login-submit-button').click()

      await expect
        .poll(async () => getUserCouponsByCustomer(createdCustomer.id), {
          message: 'expected relogin to avoid duplicate newcomer reward coupons',
          timeout: POLL_TIMEOUT_MS,
        })
        .toEqual([
          expect.objectContaining({
            coupon_id: newcomerCoupon.id,
            status: 'unused',
          }),
        ])
    } finally {
      await Promise.all([contextA.close(), contextB.close()])
    }
  })

  test('multiple newcomer reward coupons are auto-claimed only once each across relogin', async ({ browser }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 多新人礼券商品',
      price: 24,
    })

    const primaryCoupon = await createCouponAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      title: 'E2E 新人礼券 A',
      amount: 5,
      minSpend: 0,
      isNewcomerReward: true,
    })

    const secondaryCoupon = await createCouponAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      title: 'E2E 新人礼券 B',
      amount: 3,
      minSpend: 0,
      isNewcomerReward: true,
    })

    const phone = createUniquePhone()
    const [contextA, contextB] = await Promise.all([browser.newContext(), browser.newContext()])
    const [pageA, pageB] = await Promise.all([contextA.newPage(), contextB.newPage()])

    try {
      await openMenuWithItem(pageA, merchant.id, menuItem.id)
      await pageA.getByTestId(`add-to-cart-${menuItem.id}`).click()
      await pageA.getByTestId('checkout-button').click()
      await pageA.getByTestId('checkout-login-button').click()
      await pageA.getByTestId('login-phone-input').fill(phone)
      await pageA.getByTestId('login-submit-button').click()

      await expect
        .poll(async () => findCustomerByPhone(merchant.id, phone), {
          message: 'expected first newcomer login to create the customer for multi-reward auto-claim',
          timeout: POLL_TIMEOUT_MS,
        })
        .toMatchObject({
          phone,
          order_count: 0,
          points: 0,
        })

      const createdCustomer = await getCustomerByPhone(merchant.id, phone)

      await expect
        .poll(async () => getUserCouponsByCustomer(createdCustomer.id), {
          message: 'expected first newcomer login to auto-claim both newcomer reward coupons once',
          timeout: POLL_TIMEOUT_MS,
        })
        .toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              coupon_id: primaryCoupon.id,
              status: 'unused',
            }),
            expect.objectContaining({
              coupon_id: secondaryCoupon.id,
              status: 'unused',
            }),
          ]),
        )

      expect((await getUserCouponsByCustomer(createdCustomer.id)).filter((coupon) => (
        coupon.coupon_id === primaryCoupon.id || coupon.coupon_id === secondaryCoupon.id
      ))).toHaveLength(2)

      await openMenuWithItem(pageB, merchant.id, menuItem.id)
      await pageB.getByTestId(`add-to-cart-${menuItem.id}`).click()
      await pageB.getByTestId('checkout-button').click()
      await pageB.getByTestId('checkout-login-button').click()
      await pageB.getByTestId('login-phone-input').fill(phone)
      await pageB.getByTestId('login-submit-button').click()

      await expect
        .poll(async () => getUserCouponsByCustomer(createdCustomer.id), {
          message: 'expected relogin to avoid duplicating any newcomer reward coupons',
          timeout: POLL_TIMEOUT_MS,
        })
        .toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              coupon_id: primaryCoupon.id,
              status: 'unused',
            }),
            expect.objectContaining({
              coupon_id: secondaryCoupon.id,
              status: 'unused',
            }),
          ]),
        )

      expect((await getUserCouponsByCustomer(createdCustomer.id)).filter((coupon) => (
        coupon.coupon_id === primaryCoupon.id || coupon.coupon_id === secondaryCoupon.id
      ))).toHaveLength(2)
    } finally {
      await Promise.all([contextA.close(), contextB.close()])
    }
  })

  test('multiple newcomer reward coupons stay deduplicated during concurrent first-time logins', async ({ browser }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 并发新人礼券商品',
      price: 24,
    })

    const primaryCoupon = await createCouponAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      title: 'E2E 并发新人礼券 A',
      amount: 5,
      minSpend: 0,
      isNewcomerReward: true,
    })

    const secondaryCoupon = await createCouponAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      title: 'E2E 并发新人礼券 B',
      amount: 3,
      minSpend: 0,
      isNewcomerReward: true,
    })

    const phone = createUniquePhone()
    const [contextA, contextB] = await Promise.all([browser.newContext(), browser.newContext()])
    const [pageA, pageB] = await Promise.all([contextA.newPage(), contextB.newPage()])

    try {
      await Promise.all([
        openMenuWithItem(pageA, merchant.id, menuItem.id),
        openMenuWithItem(pageB, merchant.id, menuItem.id),
      ])

      await Promise.all([
        pageA.getByTestId(`add-to-cart-${menuItem.id}`).click(),
        pageB.getByTestId(`add-to-cart-${menuItem.id}`).click(),
      ])

      await Promise.all([
        pageA.getByTestId('checkout-button').click(),
        pageB.getByTestId('checkout-button').click(),
      ])

      await Promise.all([
        pageA.getByTestId('checkout-login-button').click(),
        pageB.getByTestId('checkout-login-button').click(),
      ])

      await Promise.all([
        pageA.getByTestId('login-phone-input').fill(phone),
        pageB.getByTestId('login-phone-input').fill(phone),
      ])

      await Promise.all([
        pageA.getByTestId('login-submit-button').click(),
        pageB.getByTestId('login-submit-button').click(),
      ])

      await expect
        .poll(async () => findCustomerByPhone(merchant.id, phone), {
          message: 'expected concurrent first-time logins to create only one customer record',
          timeout: POLL_TIMEOUT_MS,
        })
        .toMatchObject({
          phone,
          order_count: 0,
          points: 0,
        })

      const createdCustomer = await getCustomerByPhone(merchant.id, phone)

      await expect
        .poll(async () => getUserCouponsByCustomer(createdCustomer.id), {
          message: 'expected concurrent first-time logins to auto-claim each newcomer reward coupon only once',
          timeout: POLL_TIMEOUT_MS,
        })
        .toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              coupon_id: primaryCoupon.id,
              status: 'unused',
            }),
            expect.objectContaining({
              coupon_id: secondaryCoupon.id,
              status: 'unused',
            }),
          ]),
        )

      expect((await getUserCouponsByCustomer(createdCustomer.id)).filter((coupon) => (
        coupon.coupon_id === primaryCoupon.id || coupon.coupon_id === secondaryCoupon.id
      ))).toHaveLength(2)
    } finally {
      await Promise.all([contextA.close(), contextB.close()])
    }
  })

  test('stackable coupons combine with the best non-stackable coupon', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 多券叠加菜品',
      price: 40,
    })

    const seededCustomer = await createCustomerForMerchant({
      merchantId: merchant.id,
      phone: `135${Date.now().toString().slice(-8)}`,
      name: '叠加券顾客',
      address: '上海市浦东新区叠加券测试路 18 号',
    })

    const { userCoupon: baseCoupon } = await createUnusedCouponForCustomerAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      customerId: seededCustomer.id,
      amount: 5,
      title: 'E2E 底券5元',
    })

    const { userCoupon: stackableCoupon } = await createUnusedCouponForCustomerAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      customerId: seededCustomer.id,
      amount: 3,
      title: 'E2E 叠加券3元',
      stackable: true,
    })

    await openMenuWithItem(page, merchant.id, menuItem.id)

    await page.getByTestId(`add-to-cart-${menuItem.id}`).click()
    await page.getByTestId('checkout-button').click()

    const form = page.getByTestId('order-form')
    await expect(form).toBeVisible()

    await form.locator('input').nth(0).fill('叠加券顾客')
    await form.locator('input[type="tel"]').fill(seededCustomer.phone!)
    await form.locator('textarea').fill('上海市浦东新区叠加券测试路 18 号')

    await expect(form.getByTestId('coupon-trigger')).toContainText('8.00', { timeout: POLL_TIMEOUT_MS })
    await form.getByTestId('submit-order-button').click()

    await expect
      .poll(async () => findLatestOrderForPhone(merchant.id, seededCustomer.phone!), {
        message: 'expected stackable coupon and base coupon to combine on checkout',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        status: 'pending',
        original_amount: 40,
        total_amount: 32,
        coupon_discount_amount: 8,
      })

    await expect
      .poll(async () => Promise.all([getUserCouponById(baseCoupon.id), getUserCouponById(stackableCoupon.id)]), {
        message: 'expected both coupons to be marked as used after stacked checkout',
        timeout: POLL_TIMEOUT_MS,
      })
      .toEqual([
        expect.objectContaining({ status: 'used' }),
        expect.objectContaining({ status: 'used' }),
      ])
  })

  test('switching coupons updates checkout totals immediately', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 切换优惠券即时刷新',
      price: 36,
    })

    const seededCustomer = await createCustomerForMerchant({
      merchantId: merchant.id,
      phone: `132${Date.now().toString().slice(-8)}`,
      name: '切换优惠券顾客',
      address: '上海市浦东新区优惠券切换测试路 28 号',
    })

    const { userCoupon: highCoupon } = await createUnusedCouponForCustomerAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      customerId: seededCustomer.id,
      amount: 8,
      title: 'E2E 8元券',
    })

    const { userCoupon: lowCoupon } = await createUnusedCouponForCustomerAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      customerId: seededCustomer.id,
      amount: 5,
      title: 'E2E 5元券',
    })

    await openMenuWithItem(page, merchant.id, menuItem.id)

    await page.getByTestId(`add-to-cart-${menuItem.id}`).click()
    await page.getByTestId('checkout-button').click()

    const form = page.getByTestId('order-form')
    await expect(form).toBeVisible()

    await form.locator('input').nth(0).fill('切换优惠券顾客')
    await form.locator('input[type="tel"]').fill(seededCustomer.phone!)
    await form.locator('textarea').fill('上海市浦东新区优惠券切换测试路 28 号')

    await expect(form.getByTestId('coupon-trigger')).toContainText('8.00', { timeout: POLL_TIMEOUT_MS })
    await expect(form.getByTestId('checkout-coupon-discount-amount')).toContainText('8.00')
    await expect(form.getByTestId('checkout-total-amount')).toContainText('28.00')

    await form.getByTestId('coupon-trigger').click()
    await page.getByTestId(`coupon-option-${lowCoupon.id}`).click()
    await page.getByTestId('coupon-picker-confirm').click()

    await expect(form.getByTestId('coupon-trigger')).toContainText('5.00')
    await expect(form.getByTestId('checkout-coupon-discount-amount')).toContainText('5.00')
    await expect(form.getByTestId('checkout-total-amount')).toContainText('31.00')

    await expect(await getUserCouponById(highCoupon.id)).toMatchObject({ status: 'unused' })
  })

  test('targeted coupon stays unused when the matching item is not in the cart', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem: normalItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 普通菜品',
      price: 30,
    })
    const { menuItem: targetItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 定向菜品',
      price: 12,
    })

    const seededCustomer = await createCustomerForMerchant({
      merchantId: merchant.id,
      phone: `134${Date.now().toString().slice(-8)}`,
      name: '定向券顾客',
      address: '上海市浦东新区定向券测试路 66 号',
    })

    const { coupon: targetedCoupon, userCoupon } = await createUnusedCouponForCustomerAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      customerId: seededCustomer.id,
      amount: 7,
      title: 'E2E 定向7元券',
      targetType: 'category',
      targetItemIds: [targetItem.id],
    })

    await openMenuWithItem(page, merchant.id, normalItem.id)

    await page.getByTestId(`add-to-cart-${normalItem.id}`).click()
    await page.getByTestId('checkout-button').click()

    const form = page.getByTestId('order-form')
    await expect(form).toBeVisible()

    await form.locator('input').nth(0).fill('定向券顾客')
    await form.locator('input[type="tel"]').fill(seededCustomer.phone!)
    await form.locator('textarea').fill('上海市浦东新区定向券测试路 66 号')

    await expect(form.getByTestId('coupon-trigger')).not.toContainText('7.00')
    await form.getByTestId('submit-order-button').click()

    await expect
      .poll(async () => findLatestOrderForPhone(merchant.id, seededCustomer.phone!), {
        message: 'expected targeted coupon to be skipped when the cart misses the target item',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        status: 'pending',
        original_amount: 30,
        total_amount: 30,
        coupon_discount_amount: 0,
      })

    await expect
      .poll(async () => getUserCouponById(userCoupon.id), {
        message: 'expected unmatched targeted coupon to remain unused',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        coupon_id: targetedCoupon.id,
        status: 'unused',
      })
  })

  test('targeted coupon applies when the matching item is in the cart', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem: targetItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 定向命中菜品',
      price: 22,
    })

    const seededCustomer = await createCustomerForMerchant({
      merchantId: merchant.id,
      phone: `133${Date.now().toString().slice(-8)}`,
      name: '定向命中顾客',
      address: '上海市浦东新区定向命中测试路 99 号',
    })

    const { coupon: targetedCoupon, userCoupon } = await createUnusedCouponForCustomerAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      customerId: seededCustomer.id,
      amount: 6,
      title: 'E2E 定向6元券',
      targetType: 'category',
      targetItemIds: [targetItem.id],
    })

    await openMenuWithItem(page, merchant.id, targetItem.id)

    await page.getByTestId(`add-to-cart-${targetItem.id}`).click()
    await page.getByTestId('checkout-button').click()

    const form = page.getByTestId('order-form')
    await expect(form).toBeVisible()

    await form.locator('input').nth(0).fill('定向命中顾客')
    await form.locator('input[type="tel"]').fill(seededCustomer.phone!)
    await form.locator('textarea').fill('上海市浦东新区定向命中测试路 99 号')

    await expect(form.getByTestId('coupon-trigger')).toContainText('6.00', { timeout: POLL_TIMEOUT_MS })
    await form.getByTestId('submit-order-button').click()

    await page.waitForURL(new RegExp(`/m/${merchant.id}/order/`), { timeout: POLL_TIMEOUT_MS })

    await expect
      .poll(async () => getLatestOrderForPhone(merchant.id, seededCustomer.phone!), {
        message: 'expected targeted coupon to apply when the target item is present',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        status: 'pending',
        original_amount: 22,
        total_amount: 16,
        coupon_discount_amount: 6,
      })

    await expect
      .poll(async () => getUserCouponById(userCoupon.id), {
        message: 'expected matched targeted coupon to become used',
        timeout: POLL_TIMEOUT_MS,
      })
      .toMatchObject({
        coupon_id: targetedCoupon.id,
        status: 'used',
      })
  })
})

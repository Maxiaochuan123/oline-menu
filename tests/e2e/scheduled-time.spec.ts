import { expect, test } from '@playwright/test'

import { loginAsMerchant } from './helpers/auth'
import {
  createDisabledDateAsMerchant,
  createMenuItemForMerchant,
  createMerchantAccount,
  findLatestOrderForPhone,
  getLatestOrderWithScheduleForPhone,
  updateMerchantAsMerchant,
} from './helpers/supabase'

const TOAST_TIMEOUT_MS = 10_000
const MENU_POLL_TIMEOUT_MS = 30_000

function getShanghaiNowParts() {
  const now = new Date()
  const [hour, minute] = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .format(now)
    .split(':')

  return { hour, minute }
}

function getTodayPlusDaysInShanghai(days: number) {
  const now = new Date()
  const dateText = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(now.getTime() + days * 24 * 60 * 60 * 1000))

  const [year, month, day] = dateText.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function formatDateInShanghai(date: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

function getCalendarDataDay(date: Date) {
  return date.toLocaleDateString('zh-CN')
}

function toTime(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

function formatScheduledTimeForDisplay(isoTime: string) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(isoTime))

  const month = parts.find((part) => part.type === 'month')?.value ?? ''
  const day = parts.find((part) => part.type === 'day')?.value ?? ''
  const hour = parts.find((part) => part.type === 'hour')?.value ?? ''
  const minute = parts.find((part) => part.type === 'minute')?.value ?? ''
  return `${month}月${day}日 ${hour}:${minute}`
}

function getBusinessWindowAroundNow() {
  const { hour, minute } = getShanghaiNowParts()
  const nowMinutes = Number(hour) * 60 + Number(minute)
  const openMinutes = Math.max(nowMinutes - 20, 0)
  const closeMinutes = Math.min(nowMinutes + 20, 23 * 60 + 59)
  const invalidMinutes = openMinutes > 0 ? openMinutes - 1 : closeMinutes + 1

  return {
    openTime: toTime(openMinutes),
    closeTime: toTime(closeMinutes),
    invalidTime: toTime(Math.min(Math.max(invalidMinutes, 0), 23 * 60 + 59)),
  }
}

async function openCheckoutForm(params: {
  page: import('@playwright/test').Page
  merchantId: string
  itemId: string
}) {
  const { page, merchantId, itemId } = params
  const itemLocator = page.getByTestId(`menu-item-${itemId}`)

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(`/m/${merchantId}`)
    if ((await itemLocator.count()) > 0) {
      await expect(itemLocator).toBeVisible({ timeout: MENU_POLL_TIMEOUT_MS })
      break
    }

    await page.waitForTimeout(1_000 * (attempt + 1))
  }

  await expect(itemLocator).toBeVisible({ timeout: MENU_POLL_TIMEOUT_MS })
  await page.getByTestId(`add-to-cart-${itemId}`).click()
  await page.getByTestId('checkout-button').click()
  await expect(page.getByTestId('order-form')).toBeVisible()
}

test.describe('scheduled time guards', () => {
  test.setTimeout(120_000)

  test('shows a warning when selecting a past delivery time', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 预约时间过去时间',
      price: 26,
    })

    await updateMerchantAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      patch: {
        business_hours: {
          is_enabled: true,
          open_time: '00:00',
          close_time: '23:59',
        },
      },
    })

    await openCheckoutForm({ page, merchantId: merchant.id, itemId: menuItem.id })

    const { hour, minute } = getShanghaiNowParts()
    await page.getByTestId('scheduled-time-trigger').click()
    await page.getByTestId(`scheduled-time-hour-${hour}`).click()
    await page.getByTestId(`scheduled-time-minute-${minute}`).click()

    await expect(page.getByText('预定时间无效 (必须晚于当前时间)')).toBeVisible({
      timeout: TOAST_TIMEOUT_MS,
    })
  })

  test('shows a warning when selecting a time outside business hours', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 预约时间营业时间外',
      price: 28,
    })

    const { openTime, closeTime, invalidTime } = getBusinessWindowAroundNow()
    const [invalidHour, invalidMinute] = invalidTime.split(':')

    await updateMerchantAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      patch: {
        business_hours: {
          is_enabled: true,
          open_time: openTime,
          close_time: closeTime,
        },
      },
    })

    await openCheckoutForm({ page, merchantId: merchant.id, itemId: menuItem.id })

    await page.getByTestId('scheduled-time-trigger').click()
    await page.getByTestId(`scheduled-time-hour-${invalidHour}`).click()
    await page.getByTestId(`scheduled-time-minute-${invalidMinute}`).click()

    await expect(page.getByText(`不可选择非营业时间 (${openTime} - ${closeTime})`).first()).toBeVisible({
      timeout: TOAST_TIMEOUT_MS,
    })
  })

  test('marks disabled dates as unavailable in the checkout calendar', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 预约时间店休日',
      price: 30,
    })

    const tomorrow = getTodayPlusDaysInShanghai(1)
    await createDisabledDateAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      disabledDate: formatDateInShanghai(tomorrow),
      reason: 'E2E 明日店休',
    })

    await openCheckoutForm({ page, merchantId: merchant.id, itemId: menuItem.id })

    await page.getByTestId('scheduled-date-trigger').click()

    await expect(page.locator(`[data-day="${getCalendarDataDay(tomorrow)}"]`)).toBeDisabled()
  })

  test('accepts a valid scheduled order and shows the same time on customer and merchant views', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { menuItem } = await createMenuItemForMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      itemName: 'E2E 预约成功商品',
      price: 32,
    })

    await updateMerchantAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      patch: {
        business_hours: {
          is_enabled: true,
          open_time: '00:00',
          close_time: '23:59',
        },
      },
    })

    await openCheckoutForm({ page, merchantId: merchant.id, itemId: menuItem.id })

    const customerName = '预约成功顾客'
    const customerPhone = `13${Date.now().toString().slice(-9)}`
    const form = page.getByTestId('order-form')
    await form.locator('input').nth(0).fill(customerName)
    await form.locator('input[type="tel"]').fill(customerPhone)
    await form.locator('textarea').fill('上海市浦东新区预约成功路 18 号')

    const tomorrow = getTodayPlusDaysInShanghai(1)
    const targetHour = '12'
    const targetMinute = '30'

    await page.getByTestId('scheduled-date-trigger').click()
    await page.locator(`[data-day="${getCalendarDataDay(tomorrow)}"]`).click()
    await page.getByTestId('scheduled-time-trigger').click()
    await page.getByTestId(`scheduled-time-hour-${targetHour}`).click()
    await page.getByTestId(`scheduled-time-minute-${targetMinute}`).click()
    await form.getByTestId('submit-order-button').click()

    await expect
      .poll(async () => (await findLatestOrderForPhone(merchant.id, customerPhone))?.id ?? null, {
        timeout: 30_000,
      })
      .not.toBeNull()

    const order = await getLatestOrderWithScheduleForPhone(merchant.id, customerPhone)
    const displayTime = formatScheduledTimeForDisplay(order.scheduled_time as string)

    await page.waitForURL(new RegExp(`/m/${merchant.id}/order/${order.id}$`), { timeout: 30_000 })
    await expect(page.getByText(displayTime).first()).toBeVisible()

    await loginAsMerchant(page, { phone: merchantPhone, password: merchantPassword, gotoPath: '/orders', timeoutMs: 45_000 })
    await page.getByTestId(`orders-latest-order-card-${order.id}`).click()
    await expect(page.getByTestId('merchant-order-modal')).toBeVisible()
    await expect(page.getByText(`${targetHour}:${targetMinute}`).first()).toBeVisible()

  })
})

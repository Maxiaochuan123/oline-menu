import { expect, test } from '@playwright/test'

import {
  createDisabledDateAsMerchant,
  createMerchantAccount,
  updateMerchantAsMerchant,
} from './helpers/supabase'

function getTodayInShanghai() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function getClosedBusinessHours() {
  const now = new Date()
  const nowMinutes =
    Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', hour12: false }).format(now)) *
      60 +
    Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', minute: '2-digit' }).format(now))

  const openMinutes = (nowMinutes + 5) % (24 * 60)
  const closeMinutes = (openMinutes + 1) % (24 * 60)

  const toTime = (minutes: number) =>
    `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`

  return {
    openTime: toTime(openMinutes),
    closeTime: toTime(closeMinutes),
  }
}

test.describe('store availability guards', () => {
  test.setTimeout(60_000)

  test('shows merchant pause message when orders are manually disabled', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const announcement = 'E2E 暂停接单说明'

    await updateMerchantAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      patch: {
        is_accepting_orders: false,
        announcement,
      },
    })

    await page.goto(`/m/${merchant.id}`)

    await expect(page.getByTestId('store-closed-overlay')).toBeVisible()
    await expect(page.getByTestId('store-closed-title')).toHaveText('暂停接单中')
    await expect(page.getByTestId('store-closed-message')).toHaveText(announcement)
  })

  test('shows disabled date reason when today is marked as a closed day', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const reason = 'E2E 今日店休'

    await createDisabledDateAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      disabledDate: getTodayInShanghai(),
      reason,
    })

    await page.goto(`/m/${merchant.id}`)

    await expect(page.getByTestId('store-closed-overlay')).toBeVisible()
    await expect(page.getByTestId('store-closed-title')).toHaveText('暂停接单中')
    await expect(page.getByTestId('store-closed-message')).toHaveText(reason)
  })

  test('manual pause takes priority over disabled dates and business hours on the storefront', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const announcement = 'E2E 手动暂停优先级'
    const { openTime, closeTime } = getClosedBusinessHours()

    await createDisabledDateAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      disabledDate: getTodayInShanghai(),
      reason: 'E2E 今日停业',
    })

    await updateMerchantAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      patch: {
        is_accepting_orders: false,
        announcement,
        business_hours: {
          is_enabled: true,
          open_time: openTime,
          close_time: closeTime,
        },
      },
    })

    await page.goto(`/m/${merchant.id}`)

    await expect(page.getByTestId('store-closed-overlay')).toBeVisible()
    await expect(page.getByTestId('store-closed-message')).toHaveText(announcement)
  })

  test('disabled date still blocks the storefront after the merchant resumes accepting orders', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const reason = 'E2E 恢复营业后仍命中停业日'

    await createDisabledDateAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      disabledDate: getTodayInShanghai(),
      reason,
    })

    await updateMerchantAsMerchant({
      merchantId: merchant.id,
      merchantPhone,
      merchantPassword,
      patch: {
        is_accepting_orders: true,
        business_hours: {
          is_enabled: false,
          open_time: '09:00',
          close_time: '21:00',
        },
      },
    })

    await page.goto(`/m/${merchant.id}`)

    await expect(page.getByTestId('store-closed-overlay')).toBeVisible()
    await expect(page.getByTestId('store-closed-message')).toHaveText(reason)
  })

  test('shows business hours message when visiting outside enabled hours', async ({ page }) => {
    const { merchant, phone: merchantPhone, password: merchantPassword } = await createMerchantAccount()
    const { openTime, closeTime } = getClosedBusinessHours()

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

    await page.goto(`/m/${merchant.id}`)

    await expect(page.getByTestId('store-closed-overlay')).toBeVisible()
    await expect(page.getByTestId('store-closed-title')).toHaveText('尚未开始营业')
    await expect(page.getByTestId('store-closed-message')).toHaveText(`本店营业时间：${openTime} - ${closeTime}`)
  })
})

import { expect, test } from '@playwright/test'

import {
  createCustomerOrder,
  createMerchantAccount,
  createUsedCouponForCustomerAsMerchant,
  updateOrder,
} from './helpers/supabase'

test.describe.configure({ timeout: 45_000 })

async function loginAsMerchant(page: import('@playwright/test').Page, phone: string, password: string) {
  await page.goto('/login')
  await page.locator('input[type="tel"]').fill(phone)
  await page.locator('input[type="password"]').fill(password)
  await page.locator('form button[type="submit"]').click()
  await page.waitForURL(/\/dashboard$/)
}

async function openOrderFromOrdersPage(
  page: import('@playwright/test').Page,
  phone: string,
  lastFourPhoneDigits: string,
) {
  await page.goto('/orders', { waitUntil: 'domcontentloaded' })
  await expect(page.getByText(phone)).toBeVisible()
  await page.getByText(phone).click()
  await page.getByText(new RegExp(`尾号\\s*${lastFourPhoneDigits}\\s*订单`)).click()
  await expect(page.getByText('订单详情')).toBeVisible()
}

test.describe('merchant order detail CTA visibility', () => {
  test('pending order shows cancel button and next status button for preparing', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id)

    await loginAsMerchant(page, phone, password)
    await openOrderFromOrdersPage(page, order.phone, order.phone.slice(-4))

    await expect(page.getByTestId('merchant-order-cancel-button')).toBeVisible()
    await expect(page.getByTestId('merchant-order-next-status-button')).toBeVisible()
    await expect(page.getByTestId('merchant-order-next-status-button')).toContainText('制作中')
    await expect(page.getByTestId('merchant-after-sales-handle-button')).toHaveCount(0)
  })

  test('preparing order shows next status button for delivering', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id)

    await updateOrder(order.id, {
      status: 'preparing',
      confirmed_at: new Date().toISOString(),
    })

    await loginAsMerchant(page, phone, password)
    await openOrderFromOrdersPage(page, order.phone, order.phone.slice(-4))

    await expect(page.getByTestId('merchant-order-cancel-button')).toBeVisible()
    await expect(page.getByTestId('merchant-order-next-status-button')).toContainText('配送中')
    await expect(page.getByTestId('merchant-after-sales-handle-button')).toHaveCount(0)
  })

  test('after-sales pending shows handle button and disables normal status advance', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 48)

    await updateOrder(order.id, {
      status: 'delivering',
      after_sales_status: 'pending',
      after_sales_reason: '客户在配送中申请协商退单',
    })

    await loginAsMerchant(page, phone, password)
    await openOrderFromOrdersPage(page, order.phone, order.phone.slice(-4))

    await expect(page.getByTestId('merchant-after-sales-handle-button')).toBeVisible()
    await expect(page.getByTestId('merchant-order-next-status-button')).toBeDisabled()
    await expect(page.getByTestId('merchant-order-next-status-button')).toContainText('请先处理售后')
    await expect(page.getByTestId('merchant-order-cancel-button')).toBeVisible()
  })

  test('completed order with pending after-sales only keeps the handle entry', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 54)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'pending',
      after_sales_reason: '已完成订单待处理售后',
    })

    await loginAsMerchant(page, phone, password)
    await openOrderFromOrdersPage(page, order.phone, order.phone.slice(-4))

    await expect(page.getByTestId('merchant-after-sales-handle-button')).toBeVisible()
    await expect(page.getByTestId('merchant-order-cancel-button')).toHaveCount(0)
    await expect(page.getByTestId('merchant-order-next-status-button')).toHaveCount(0)
  })

  test('completed order hides bottom action buttons', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 56)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'none',
    })

    await loginAsMerchant(page, phone, password)
    await openOrderFromOrdersPage(page, order.phone, order.phone.slice(-4))

    await expect(page.getByTestId('merchant-order-cancel-button')).toHaveCount(0)
    await expect(page.getByTestId('merchant-order-next-status-button')).toHaveCount(0)
    await expect(page.getByTestId('merchant-after-sales-handle-button')).toHaveCount(0)
  })

  test('cancelled order hides all merchant action buttons', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 64)

    await updateOrder(order.id, {
      status: 'cancelled',
      cancelled_by: 'merchant',
      cancelled_at: new Date().toISOString(),
      after_sales_status: 'none',
    })

    await loginAsMerchant(page, phone, password)
    await openOrderFromOrdersPage(page, order.phone, order.phone.slice(-4))

    await expect(page.getByTestId('merchant-order-cancel-button')).toHaveCount(0)
    await expect(page.getByTestId('merchant-order-next-status-button')).toHaveCount(0)
    await expect(page.getByTestId('merchant-after-sales-handle-button')).toHaveCount(0)
  })

  test('cancelled order without any message history hides the communication panel', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 66)

    await updateOrder(order.id, {
      status: 'cancelled',
      cancelled_by: 'customer',
      cancelled_at: new Date().toISOString(),
      after_sales_status: 'none',
    })

    await loginAsMerchant(page, phone, password)
    await openOrderFromOrdersPage(page, order.phone, order.phone.slice(-4))

    await expect(page.getByText('沟通与协商记录')).toHaveCount(0)
    await expect(page.getByTestId('merchant-order-chat-input')).toHaveCount(0)
    await expect(page.getByTestId('merchant-order-chat-send')).toHaveCount(0)
  })

  test('completed order with closed after-sales keeps all merchant action buttons hidden', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 72)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'resolved',
      refund_amount: 12,
      is_coupon_refunded: false,
    })

    await loginAsMerchant(page, phone, password)
    await openOrderFromOrdersPage(page, order.phone, order.phone.slice(-4))

    await expect(page.getByText('已完结售后')).toBeVisible()
    await expect(page.getByText('已退款金额')).toBeVisible()
    await expect(page.getByText('¥12.00', { exact: true })).toBeVisible()
    await expect(page.getByText('优惠券已退')).toHaveCount(0)
    await expect(page.getByTestId('merchant-order-cancel-button')).toHaveCount(0)
    await expect(page.getByTestId('merchant-order-next-status-button')).toHaveCount(0)
    await expect(page.getByTestId('merchant-after-sales-handle-button')).toHaveCount(0)
  })

  test('resolved after-sales shows refunded coupon summary for merchants', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { customer, order } = await createCustomerOrder(merchant.id, 74)
    const { coupon } = await createUsedCouponForCustomerAsMerchant({
      merchantId: merchant.id,
      merchantPhone: phone,
      merchantPassword: password,
      customerId: customer.id,
      amount: 8,
    })

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'resolved',
      refund_amount: 18,
      coupon_ids: [coupon.id],
      coupon_discount_amount: 8,
      is_coupon_refunded: true,
    })

    await loginAsMerchant(page, phone, password)
    await openOrderFromOrdersPage(page, order.phone, order.phone.slice(-4))

    await expect(page.getByText('已完结售后')).toBeVisible()
    await expect(page.getByText('优惠券已退')).toBeVisible()
    await expect(page.getByText(coupon.title)).toBeVisible()
    await expect(page.getByText('抵扣 ¥8.00')).toBeVisible()
    await expect(page.getByTestId('merchant-order-cancel-button')).toHaveCount(0)
    await expect(page.getByTestId('merchant-order-next-status-button')).toHaveCount(0)
    await expect(page.getByTestId('merchant-after-sales-handle-button')).toHaveCount(0)
  })

  test('completed order with rejected after-sales also keeps all merchant action buttons hidden', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 76)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'rejected',
    })

    await loginAsMerchant(page, phone, password)
    await openOrderFromOrdersPage(page, order.phone, order.phone.slice(-4))

    await expect(page.getByTestId('merchant-order-cancel-button')).toHaveCount(0)
    await expect(page.getByTestId('merchant-order-next-status-button')).toHaveCount(0)
    await expect(page.getByTestId('merchant-after-sales-handle-button')).toHaveCount(0)
    await expect(page.getByText('已完结售后')).toHaveCount(0)
    await expect(page.getByText('已退款金额')).toHaveCount(0)
    await expect(page.getByText('优惠券已退')).toHaveCount(0)
  })
})

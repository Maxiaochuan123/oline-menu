import { expect, type Locator, test } from '@playwright/test'

import { loginAsMerchant } from './helpers/auth'
import {
  createCustomerOrder,
  createMerchantAccount,
  getOrderById,
  updateOrder,
} from './helpers/supabase'

async function openOrderFromOrdersPage(
  page: import('@playwright/test').Page,
  orderId: string,
  phone: string,
) {
  await page.goto('/orders', { waitUntil: 'domcontentloaded' })

  const phoneGroup = page.getByTestId(`orders-phone-group-${phone}`)
  await expect(phoneGroup).toBeVisible({ timeout: 20_000 })

  const latestCard = page.getByTestId(`orders-latest-order-card-${orderId}`)
  await expect(latestCard).toBeVisible({ timeout: 10_000 })
  await latestCard.click()

  await expect(page.getByTestId('merchant-order-modal')).toBeVisible()
}

function getVisibleDialogButtons(page: import('@playwright/test').Page): Locator {
  return page.locator('[role="dialog"]').last().locator('button:visible')
}

function getRefundPanelFooterButtons(page: import('@playwright/test').Page): Locator {
  return page
    .locator('[role="dialog"] .p-6.bg-white.border-t.sm\\:justify-start.gap-4.flex-shrink-0')
    .last()
    .locator('button:visible')
}

test.describe('merchant order detail confirmation dialogs', () => {
  test.setTimeout(90_000)

  test('pending order opens status confirmation before advancing to preparing', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id)

    await loginAsMerchant(page, { phone, password, gotoPath: '/orders' })
    await openOrderFromOrdersPage(page, order.id, order.phone)

    await page.getByTestId('merchant-order-next-status-button').click()
    await expect(page.getByTestId('merchant-status-dialog-cancel')).toBeVisible()
    await expect(getVisibleDialogButtons(page).last()).toBeVisible()
  })

  test('closing status confirmation keeps a pending order unchanged', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id)

    await loginAsMerchant(page, { phone, password, gotoPath: '/orders' })
    await openOrderFromOrdersPage(page, order.id, order.phone)

    await page.getByTestId('merchant-order-next-status-button').click()
    await expect(page.getByTestId('merchant-status-dialog-cancel')).toBeVisible()
    await page.getByTestId('merchant-status-dialog-cancel').click()

    await expect(page.getByTestId('merchant-status-dialog-cancel')).toHaveCount(0)
    await expect.poll(async () => {
      const latestOrder = await getOrderById(order.id)
      return {
        status: latestOrder.status,
        confirmedAt: latestOrder.confirmed_at,
      }
    }, { timeout: 10_000 }).toEqual({
      status: 'pending',
      confirmedAt: null,
    })
  })

  test('pending order opens cancel confirmation before merchant cancellation', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id)

    await loginAsMerchant(page, { phone, password, gotoPath: '/orders' })
    await openOrderFromOrdersPage(page, order.id, order.phone)

    await page.getByTestId('merchant-order-cancel-button').click()
    await expect(page.getByTestId('merchant-cancel-order-dialog-cancel')).toBeVisible()
    await expect(getVisibleDialogButtons(page).last()).toBeVisible()
  })

  test('closing cancel confirmation keeps the order active', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id)

    await loginAsMerchant(page, { phone, password, gotoPath: '/orders' })
    await openOrderFromOrdersPage(page, order.id, order.phone)

    await page.getByTestId('merchant-order-cancel-button').click()
    await expect(page.getByTestId('merchant-cancel-order-dialog-cancel')).toBeVisible()
    await page.getByTestId('merchant-cancel-order-dialog-cancel').click()

    await expect(page.getByTestId('merchant-cancel-order-dialog-cancel')).toHaveCount(0)
    await expect.poll(async () => getOrderById(order.id), { timeout: 10_000 }).toMatchObject({
      status: 'pending',
    })
  })

  test('refund panel opens refund confirmation before agreeing to refund', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 48)

    await updateOrder(order.id, {
      status: 'delivering',
      after_sales_status: 'pending',
      after_sales_reason: 'refund confirm dialog test',
    })

    await loginAsMerchant(page, { phone, password, gotoPath: '/orders' })
    await openOrderFromOrdersPage(page, order.id, order.phone)

    await page.getByTestId('merchant-after-sales-handle-button').click()
    await expect(page.getByTestId('merchant-refund-fixed-input')).toBeVisible()
    await getRefundPanelFooterButtons(page).last().click()

    await expect(page.getByTestId('merchant-refund-confirm-cancel')).toBeVisible()
    await expect(getVisibleDialogButtons(page).last()).toBeVisible()
  })

  test('closing refund confirmation keeps after-sales pending', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 48)

    await updateOrder(order.id, {
      status: 'delivering',
      after_sales_status: 'pending',
      after_sales_reason: 'cancel refund confirmation test',
    })

    await loginAsMerchant(page, { phone, password, gotoPath: '/orders' })
    await openOrderFromOrdersPage(page, order.id, order.phone)

    await page.getByTestId('merchant-after-sales-handle-button').click()
    await expect(page.getByTestId('merchant-refund-fixed-input')).toBeVisible()
    await getRefundPanelFooterButtons(page).last().click()
    await expect(page.getByTestId('merchant-refund-confirm-cancel')).toBeVisible()
    await page.getByTestId('merchant-refund-confirm-cancel').click()

    await expect(page.getByTestId('merchant-refund-confirm-cancel')).toHaveCount(0)
    await expect.poll(async () => getOrderById(order.id), { timeout: 10_000 }).toMatchObject({
      status: 'delivering',
      after_sales_status: 'pending',
      refund_amount: null,
    })
  })

  test('refund panel opens reject confirmation before rejecting after-sales', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 52)

    await updateOrder(order.id, {
      status: 'delivering',
      after_sales_status: 'pending',
      after_sales_reason: 'reject confirm dialog test',
    })

    await loginAsMerchant(page, { phone, password, gotoPath: '/orders' })
    await openOrderFromOrdersPage(page, order.id, order.phone)

    await page.getByTestId('merchant-after-sales-handle-button').click()
    await expect(page.getByTestId('merchant-refund-fixed-input')).toBeVisible()
    await getRefundPanelFooterButtons(page).first().click()

    await expect(page.getByTestId('merchant-reject-confirm-cancel')).toBeVisible()
    await expect(getVisibleDialogButtons(page).last()).toBeVisible()
  })
})

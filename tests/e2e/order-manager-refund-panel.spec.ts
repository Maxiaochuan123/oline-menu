import { expect, test } from '@playwright/test'

import {
  createCustomerOrder,
  createMerchantAccount,
  getOrderItems,
  updateOrder,
} from './helpers/supabase'

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
  await page.goto('/orders')
  await page.getByText(phone).click()
  await page.getByText(new RegExp(`尾号\\s*${lastFourPhoneDigits}\\s*订单`)).click()
  await expect(page.getByText('订单详情')).toBeVisible()
}

test.describe('merchant refund panel interactions', () => {
  test('completed order with pending after-sales can still open the refund panel', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 66)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'pending',
      after_sales_reason: '顾客在已完成后申请售后',
    })

    await loginAsMerchant(page, phone, password)
    await openOrderFromOrdersPage(page, order.phone, order.phone.slice(-4))

    await page.getByTestId('merchant-after-sales-handle-button').click()
    await expect(page.getByRole('heading', { name: '退款协商控制台' })).toBeVisible()
    await expect(page.getByTestId('merchant-refund-fixed-input')).toBeVisible()
    await expect(page.getByRole('button', { name: '同意入账并完结' })).toBeVisible()
  })

  test('switching refund modes updates the computed refund total immediately', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 60)

    await updateOrder(order.id, {
      status: 'delivering',
      after_sales_status: 'pending',
      after_sales_reason: '客户在配送中申请协商退单',
    })

    await loginAsMerchant(page, phone, password)
    await openOrderFromOrdersPage(page, order.phone, order.phone.slice(-4))

    await page.getByTestId('merchant-after-sales-handle-button').click()
    await expect(page.getByTestId('merchant-refund-fixed-input')).toHaveValue('12')
    await expect(page.getByTestId('merchant-refund-total')).toContainText('12.00')

    await page.getByTestId('merchant-refund-mode-ratio').click()
    await page.getByTestId('merchant-refund-ratio-input').fill('50')
    await expect(page.getByTestId('merchant-refund-total')).toContainText('30.00')

    await page.getByTestId('merchant-refund-mode-items').click()
    await expect(page.getByTestId('merchant-refund-total')).toContainText('60.00')
  })

  test('items mode updates the refund total when all selected items are cleared', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 48)

    await updateOrder(order.id, {
      status: 'delivering',
      after_sales_status: 'pending',
      after_sales_reason: '客户在配送中申请协商退单',
    })

    const [orderItem] = await getOrderItems(order.id)
    expect(orderItem).toBeTruthy()

    await loginAsMerchant(page, phone, password)
    await openOrderFromOrdersPage(page, order.phone, order.phone.slice(-4))

    await page.getByTestId('merchant-after-sales-handle-button').click()
    await page.getByTestId('merchant-refund-mode-items').click()
    await expect(page.getByTestId(`merchant-refund-item-qty-${orderItem.id}`)).toHaveText('1')
    await expect(page.getByTestId('merchant-refund-total')).toContainText('48.00')

    await page.getByTestId(`merchant-refund-item-check-${orderItem.id}`).click()
    await expect(page.getByTestId(`merchant-refund-item-qty-${orderItem.id}`)).toHaveText('0')
    await expect(page.getByTestId('merchant-refund-total')).toContainText('0.00')
  })
})

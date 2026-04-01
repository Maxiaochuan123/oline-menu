import { expect, test } from '@playwright/test'

import { seedCustomerInfo } from './helpers/auth'
import {
  createCustomerForMerchant,
  createMerchantAccount,
  createOrderForCustomer,
} from './helpers/supabase'

test.describe('customer order lookup page', () => {
  test.setTimeout(90_000)

  test('shows the empty state when no customer info is stored locally', async ({ page }) => {
    const { merchant } = await createMerchantAccount()

    await page.goto(`/m/${merchant.id}/orders`)

    await expect(page.getByTestId('customer-orders-empty-state')).toBeVisible()
    await expect(page.locator('[data-testid^="customer-order-card-"]')).toHaveCount(0)
  })

  test('shows the empty state when customer info exists but there are no orders', async ({ page }) => {
    const { merchant } = await createMerchantAccount()
    const customerPhone = `13${Date.now().toString().slice(-9)}`

    await seedCustomerInfo(page, {
      merchantId: merchant.id,
      phone: customerPhone,
      name: 'Lookup Empty Customer',
      gotoPath: `/m/${merchant.id}/orders`,
    })
    await page.goto(`/m/${merchant.id}/orders`)

    await expect(page.getByTestId('customer-orders-empty-state')).toBeVisible()
    await expect(page.locator('[data-testid^="customer-order-card-"]')).toHaveCount(0)
  })

  test('renders multiple orders for the stored customer and opens the selected detail page', async ({ page }) => {
    const { merchant } = await createMerchantAccount()
    const customerPhone = `13${Date.now().toString().slice(-9)}`
    const customer = await createCustomerForMerchant({
      merchantId: merchant.id,
      phone: customerPhone,
      name: 'Lookup Customer',
      address: 'Shanghai Lookup Road 66',
    })

    const firstOrder = await createOrderForCustomer({
      merchantId: merchant.id,
      customerId: customer.id,
      phone: customerPhone,
      customerName: 'Lookup Customer',
      amount: 18,
      status: 'pending',
    })
    await createOrderForCustomer({
      merchantId: merchant.id,
      customerId: customer.id,
      phone: customerPhone,
      customerName: 'Lookup Customer',
      amount: 28,
      status: 'completed',
    })

    await seedCustomerInfo(page, {
      merchantId: merchant.id,
      phone: customerPhone,
      name: 'Lookup Customer',
      gotoPath: `/m/${merchant.id}/orders`,
    })
    await page.goto(`/m/${merchant.id}/orders`)

    await expect(page.locator('[data-testid^="customer-order-card-"]')).toHaveCount(2)
    await page.getByTestId(`customer-order-card-${firstOrder.id}`).click()
    await page.waitForURL(new RegExp(`/m/${merchant.id}/order/${firstOrder.id}$`))
  })
})

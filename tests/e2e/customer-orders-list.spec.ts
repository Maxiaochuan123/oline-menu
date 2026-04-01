import { expect, test } from '@playwright/test'

import { seedCustomerInfo } from './helpers/auth'
import {
  createCustomerForMerchant,
  createMerchantAccount,
  createOrderForCustomer,
  updateOrder,
} from './helpers/supabase'

test.describe('customer orders list', () => {
  test.setTimeout(90_000)

  test('shows the empty state when no customer info is stored locally', async ({ page }) => {
    const { merchant } = await createMerchantAccount()

    await page.goto(`/m/${merchant.id}/my-orders`)

    await expect(page.getByTestId('customer-orders-empty-state')).toBeVisible()
    await expect(page.locator('[data-testid^="customer-order-card-"]')).toHaveCount(0)
  })

  test('shows the empty state when customer info exists but there are no orders', async ({ page }) => {
    const { merchant } = await createMerchantAccount()
    const customerPhone = `13${Date.now().toString().slice(-9)}`

    await seedCustomerInfo(page, {
      merchantId: merchant.id,
      phone: customerPhone,
      name: '空订单顾客',
      gotoPath: `/m/${merchant.id}/my-orders`,
    })
    await page.goto(`/m/${merchant.id}/my-orders`)

    await expect(page.getByTestId('customer-orders-empty-state')).toBeVisible()
    await expect(page.locator('[data-testid^="customer-order-card-"]')).toHaveCount(0)
  })

  test('groups multiple orders for the same customer and opens the selected order detail', async ({ page }) => {
    const { merchant } = await createMerchantAccount()
    const customerPhone = `13${Date.now().toString().slice(-9)}`
    const customer = await createCustomerForMerchant({
      merchantId: merchant.id,
      phone: customerPhone,
      name: '列表顾客',
      address: '上海市浦东新区列表路 8 号',
    })

    const pendingOrder = await createOrderForCustomer({
      merchantId: merchant.id,
      customerId: customer.id,
      phone: customerPhone,
      customerName: '列表顾客',
      amount: 18,
      status: 'pending',
    })
    await createOrderForCustomer({
      merchantId: merchant.id,
      customerId: customer.id,
      phone: customerPhone,
      customerName: '列表顾客',
      amount: 28,
      status: 'completed',
    })
    await createOrderForCustomer({
      merchantId: merchant.id,
      customerId: customer.id,
      phone: customerPhone,
      customerName: '列表顾客',
      amount: 38,
      status: 'delivering',
    })

    await seedCustomerInfo(page, {
      merchantId: merchant.id,
      phone: customerPhone,
      name: '列表顾客',
      gotoPath: `/m/${merchant.id}/my-orders`,
    })
    await page.goto(`/m/${merchant.id}/my-orders`)

    await expect(page.locator('[data-testid^="customer-order-card-"]')).toHaveCount(3)
    await page.getByTestId(`customer-order-card-${pendingOrder.id}`).click()
    await page.waitForURL(new RegExp(`/m/${merchant.id}/order/${pendingOrder.id}$`))
  })

  test('moves an order into history after its status changes to completed', async ({ page }) => {
    const { merchant } = await createMerchantAccount()
    const customerPhone = `13${Date.now().toString().slice(-9)}`
    const customer = await createCustomerForMerchant({
      merchantId: merchant.id,
      phone: customerPhone,
      name: '状态顾客',
    })

    const preparingOrder = await createOrderForCustomer({
      merchantId: merchant.id,
      customerId: customer.id,
      phone: customerPhone,
      customerName: '状态顾客',
      amount: 42,
      status: 'preparing',
    })

    await seedCustomerInfo(page, {
      merchantId: merchant.id,
      phone: customerPhone,
      name: '状态顾客',
      gotoPath: `/m/${merchant.id}/my-orders`,
    })
    await page.goto(`/m/${merchant.id}/my-orders`)
    await expect(page.getByTestId(`customer-order-card-${preparingOrder.id}`)).toBeVisible()

    await updateOrder(preparingOrder.id, { status: 'completed' })
    await page.reload()

    await expect(page.getByTestId(`customer-order-card-${preparingOrder.id}`)).toBeVisible()
    await expect(page.locator('h3')).toHaveCount(1)
  })

  test('renders a long mixed order list and still opens the selected history order', async ({ page }) => {
    const { merchant } = await createMerchantAccount()
    const customerPhone = `13${Date.now().toString().slice(-9)}`
    const customer = await createCustomerForMerchant({
      merchantId: merchant.id,
      phone: customerPhone,
      name: 'Long List Customer',
      address: 'Shanghai Long List Road 12',
    })

    const createdOrders: string[] = []
    const statuses = [
      'pending',
      'preparing',
      'delivering',
      'completed',
      'cancelled',
      'pending',
      'preparing',
      'delivering',
      'completed',
      'cancelled',
      'completed',
      'delivering',
    ]

    for (let index = 0; index < statuses.length; index += 1) {
      const order = await createOrderForCustomer({
        merchantId: merchant.id,
        customerId: customer.id,
        phone: customerPhone,
        customerName: 'Long List Customer',
        amount: 20 + index,
        status: statuses[index],
      })
      createdOrders.push(order.id)
    }

    const targetHistoryOrderId = createdOrders[10]

    await seedCustomerInfo(page, {
      merchantId: merchant.id,
      phone: customerPhone,
      name: 'Long List Customer',
      gotoPath: `/m/${merchant.id}/my-orders`,
    })
    await page.goto(`/m/${merchant.id}/my-orders`)

    await expect(page.locator('[data-testid^="customer-order-card-"]')).toHaveCount(12)
    await expect(page.getByTestId(`customer-order-card-${targetHistoryOrderId}`)).toBeVisible()

    await page.getByTestId(`customer-order-card-${targetHistoryOrderId}`).click()
    await page.waitForURL(new RegExp(`/m/${merchant.id}/order/${targetHistoryOrderId}$`))
  })
})

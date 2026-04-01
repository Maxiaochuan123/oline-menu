import { expect, test } from '@playwright/test'

import {
  createCustomerOrder,
  createMerchantAccount,
  createUsedCouponForCustomerAsMerchant,
  getOrderItems,
  updateMerchantAsMerchant,
  updateOrder,
} from './helpers/supabase'

test.describe('customer order detail CTA visibility', () => {
  test('pending order shows pay and cancel CTAs when merchant has payment QR', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id)

    await updateMerchantAsMerchant({
      merchantId: merchant.id,
      merchantPhone: phone,
      merchantPassword: password,
      patch: {
        payment_qr_url: 'https://example.com/e2e-payment-qr.png',
      },
    })

    await page.goto(`/m/${merchant.id}/order/${order.id}`)

    await expect(page.getByTestId('order-cta-pay')).toBeVisible()
    await expect(page.getByTestId('order-cta-cancel')).toBeVisible()
    await expect(page.getByTestId('order-cta-negotiate')).toHaveCount(0)
    await expect(page.getByTestId('order-cta-after-sales')).toHaveCount(0)
    await expect(page.getByTestId('order-after-sales-pending')).toHaveCount(0)
  })

  test('delivering order shows cancel and negotiate CTAs before after-sales starts', async ({ page }) => {
    const { merchant } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 48)

    await updateOrder(order.id, {
      status: 'delivering',
      after_sales_status: 'none',
    })

    await page.goto(`/m/${merchant.id}/order/${order.id}`)

    await expect(page.getByTestId('order-cta-cancel')).toBeVisible()
    await expect(page.getByTestId('order-cta-negotiate')).toBeVisible()
    await expect(page.getByTestId('order-cta-pay')).toHaveCount(0)
    await expect(page.getByTestId('order-cta-after-sales')).toHaveCount(0)
  })

  test('completed order shows after-sales CTA only', async ({ page }) => {
    const { merchant } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 52)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'none',
    })

    await page.goto(`/m/${merchant.id}/order/${order.id}`)

    await expect(page.getByTestId('order-cta-after-sales')).toBeVisible()
    await expect(page.getByTestId('order-cta-cancel')).toHaveCount(0)
    await expect(page.getByTestId('order-cta-negotiate')).toHaveCount(0)
    await expect(page.getByTestId('order-cta-pay')).toHaveCount(0)
  })

  test('after-sales pending hides normal CTAs and shows urge action', async ({ page }) => {
    const { merchant } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 58)

    await updateOrder(order.id, {
      status: 'delivering',
      after_sales_status: 'pending',
      after_sales_reason: '客户在配送中申请协商退单',
      after_sales_urge_count: 0,
      after_sales_last_urge_at: null,
    })

    await page.goto(`/m/${merchant.id}/order/${order.id}`)

    await expect(page.getByTestId('order-after-sales-pending')).toBeVisible()
    await expect(page.getByTestId('order-cta-urge')).toBeVisible()
    await expect(page.getByTestId('order-cta-cancel')).toHaveCount(0)
    await expect(page.getByTestId('order-cta-negotiate')).toHaveCount(0)
    await expect(page.getByTestId('order-cta-after-sales')).toHaveCount(0)
  })

  test('completed order with pending after-sales still shows only the pending state and urge action', async ({ page }) => {
    const { merchant } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 60)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'pending',
      after_sales_reason: '顾客已提交完成后售后申请',
      after_sales_urge_count: 0,
      after_sales_last_urge_at: null,
    })

    await page.goto(`/m/${merchant.id}/order/${order.id}`)

    await expect(page.getByTestId('order-after-sales-pending')).toBeVisible()
    await expect(page.getByTestId('order-cta-urge')).toBeVisible()
    await expect(page.getByTestId('order-cta-after-sales')).toHaveCount(0)
    await expect(page.getByTestId('order-cta-cancel')).toHaveCount(0)
    await expect(page.getByTestId('order-cta-negotiate')).toHaveCount(0)
    await expect(page.getByTestId('order-cta-pay')).toHaveCount(0)
  })

  test('completed order hides after-sales CTA once the request has already been resolved or rejected', async ({ page }) => {
    const { merchant } = await createMerchantAccount()
    const { order: resolvedOrder } = await createCustomerOrder(merchant.id, 62)
    const { order: rejectedOrder } = await createCustomerOrder(merchant.id, 64)

    await updateOrder(resolvedOrder.id, {
      status: 'completed',
      after_sales_status: 'resolved',
      refund_amount: 12,
    })

    await page.goto(`/m/${merchant.id}/order/${resolvedOrder.id}`)
    await expect(page.getByTestId('order-cta-after-sales')).toHaveCount(0)
    await expect(page.getByTestId('order-after-sales-pending')).toHaveCount(0)

    await updateOrder(rejectedOrder.id, {
      status: 'completed',
      after_sales_status: 'rejected',
      after_sales_reason: '顾客已提交过售后申请',
    })

    await page.goto(`/m/${merchant.id}/order/${rejectedOrder.id}`)
    await expect(page.getByTestId('order-cta-after-sales')).toHaveCount(0)
    await expect(page.getByTestId('order-after-sales-pending')).toHaveCount(0)
    await expect(page.getByText('售后处理完毕')).toHaveCount(0)
    await expect(page.getByText('退款金额')).toHaveCount(0)
    await expect(page.getByText('优惠券已原路退回')).toHaveCount(0)
  })

  test('resolved after-sales shows the refund result but keeps all customer CTAs hidden', async ({ page }) => {
    const { merchant } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 70)

    await updateOrder(order.id, {
      status: 'completed',
      after_sales_status: 'resolved',
      refund_amount: 18,
      is_coupon_refunded: false,
    })

    await page.goto(`/m/${merchant.id}/order/${order.id}`)

    await expect(page.getByText('售后处理完毕')).toBeVisible()
    await expect(page.getByText('退款金额')).toBeVisible()
    await expect(page.getByText('¥18.00', { exact: true })).toBeVisible()
    await expect(page.getByText('优惠券已原路退回')).toHaveCount(0)
    await expect(page.getByTestId('order-cta-after-sales')).toHaveCount(0)
    await expect(page.getByTestId('order-cta-cancel')).toHaveCount(0)
    await expect(page.getByTestId('order-cta-negotiate')).toHaveCount(0)
    await expect(page.getByTestId('order-cta-urge')).toHaveCount(0)
  })

  test('resolved after-sales shows refunded coupon summary when the coupon is returned', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { customer, order } = await createCustomerOrder(merchant.id, 72)
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
      refund_amount: 20,
      coupon_ids: [coupon.id],
      coupon_discount_amount: 8,
      is_coupon_refunded: true,
    })

    await page.goto(`/m/${merchant.id}/order/${order.id}`)

    await expect(page.getByText('售后处理完毕')).toBeVisible()
    await expect(page.getByText('优惠券已原路退回')).toBeVisible()
    await expect(page.getByText(coupon.title)).toBeVisible()
    await expect(page.getByText('+¥8.00')).toBeVisible()
    await expect(page.getByTestId('order-cta-after-sales')).toHaveCount(0)
    await expect(page.getByTestId('order-cta-cancel')).toHaveCount(0)
    await expect(page.getByTestId('order-cta-negotiate')).toHaveCount(0)
    await expect(page.getByTestId('order-cta-urge')).toHaveCount(0)
  })

  test('cancelled order hides all customer action CTAs', async ({ page }) => {
    const { merchant, phone, password } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 66)

    await updateMerchantAsMerchant({
      merchantId: merchant.id,
      merchantPhone: phone,
      merchantPassword: password,
      patch: {
        payment_qr_url: 'https://example.com/e2e-payment-qr.png',
      },
    })

    await updateOrder(order.id, {
      status: 'cancelled',
      cancelled_by: 'customer',
      cancelled_at: new Date().toISOString(),
      refund_amount: 66,
    })

    await page.goto(`/m/${merchant.id}/order/${order.id}`)

    await expect(page.getByTestId('order-cta-pay')).toHaveCount(0)
    await expect(page.getByTestId('order-cta-cancel')).toHaveCount(0)
    await expect(page.getByTestId('order-cta-negotiate')).toHaveCount(0)
    await expect(page.getByTestId('order-cta-after-sales')).toHaveCount(0)
    await expect(page.getByTestId('order-cta-urge')).toHaveCount(0)
  })

  test('cancelled order still offers reorder entry and restores the original cart items', async ({ page }) => {
    const { merchant } = await createMerchantAccount()
    const { order } = await createCustomerOrder(merchant.id, 68)
    const [orderItem] = await getOrderItems(order.id)

    expect(orderItem).toBeTruthy()

    await updateOrder(order.id, {
      status: 'cancelled',
      cancelled_by: 'customer',
      cancelled_at: new Date().toISOString(),
      refund_amount: 68,
    })

    await page.goto(`/m/${merchant.id}/order/${order.id}`)

    await expect(page.getByRole('button', { name: '重新下单' })).toBeVisible()
    await page.getByRole('button', { name: '重新下单' }).click()

    await expect(page).toHaveURL(new RegExp(`/m/${merchant.id}$`))
    await expect
      .poll(async () => page.evaluate((merchantId) => localStorage.getItem(`cart_${merchantId}`), merchant.id))
      .not.toBeNull()

    const restoredCart = await page.evaluate((merchantId) => {
      const raw = localStorage.getItem(`cart_${merchantId}`)
      return raw ? JSON.parse(raw) : null
    }, merchant.id)

    expect(restoredCart).toEqual([
      expect.objectContaining({
        quantity: orderItem.quantity,
        menuItem: expect.objectContaining({
          id: orderItem.menu_item_id || orderItem.id,
          name: orderItem.item_name,
          price: orderItem.item_price,
        }),
      }),
    ])
  })
})

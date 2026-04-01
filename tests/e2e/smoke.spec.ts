import { expect, test } from '@playwright/test'

test.describe('anonymous smoke', () => {
  test('root redirects to login', async ({ page }) => {
    await page.goto('/')

    await expect(page).toHaveURL(/\/login$/)
    await expect(page.locator('input')).toHaveCount(2)
  })

  test('protected merchant pages redirect to login', async ({ page }) => {
    await page.goto('/dashboard')

    await expect(page).toHaveURL(/\/login$/)
  })
})

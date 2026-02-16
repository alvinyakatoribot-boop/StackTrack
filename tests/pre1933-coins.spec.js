const { test, expect } = require('@playwright/test');

const BASE_SETTINGS = {
  shopName: 'Test Bullion Shop',
  sellPremCoins: 7, sellPremBars: 5, sellPremScrap: 3,
  buyDiscCoins: 3, buyDiscBars: 5, buyDiscScrap: 8,
  whDiscCoins: 1, whDiscBars: 2, whDiscScrap: 3,
  coinAdjustments: { eagles: 0, maples: 0, krugerrands: 0, britannias: 0, philharmonics: 0, pre33: 0 },
  junkDivisor: 1.3, junkMultOverride: null,
  threshGold: 10, threshSilver: 500,
};

async function mockSpotPrices(page, { gold = 2500, silver = 32 } = {}) {
  await page.route('**/api.gold-api.com/price/XAU', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ price: gold }) }),
  );
  await page.route('**/api.gold-api.com/price/XAG', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ price: silver }) }),
  );
}

async function seedAndReload(page, data) {
  await page.evaluate((d) => {
    localStorage.setItem('st_settings', JSON.stringify(d.settings));
    localStorage.setItem('st_transactions', JSON.stringify(d.transactions));
    localStorage.setItem('st_customers', JSON.stringify(d.customers));
    localStorage.setItem('st_contacts', JSON.stringify(d.contacts));
  }, data);
  await page.reload();
  await page.waitForFunction(() => {
    const el = document.getElementById('outSpot');
    return el && !el.textContent.includes('$0.00');
  }, { timeout: 5000 });
}

function emptyData() {
  return { settings: BASE_SETTINGS, transactions: [], customers: [], contacts: [] };
}

// ─── Pre-1933 US Gold Coins ─────────────────────────────────────────

test.describe('Pre-1933 US Gold Coins', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page, emptyData());
    await page.click('[data-page="calculator"]');
  });

  test('Pre-1933 coin types appear in calculator dropdown', async ({ page }) => {
    const options = await page.locator('#calcCoinType option').allTextContents();
    expect(options).toContain('$20 Double Eagle');
    expect(options).toContain('$10 Eagle');
    expect(options).toContain('$5 Half Eagle');
    expect(options).toContain('$2.50 Quarter Eagle');
  });

  test('Selecting a pre-1933 coin locks metal to gold', async ({ page }) => {
    await page.selectOption('#calcForm', 'coins');
    await page.selectOption('#calcCoinType', 'pre33_20');
    await expect(page.locator('#calcMetal')).toHaveValue('gold');
    await expect(page.locator('#calcMetal')).toBeDisabled();
  });

  test('Switching away from pre-1933 re-enables metal selector', async ({ page }) => {
    await page.selectOption('#calcForm', 'coins');
    await page.selectOption('#calcCoinType', 'pre33_10');
    await expect(page.locator('#calcMetal')).toBeDisabled();

    await page.selectOption('#calcCoinType', 'eagles');
    await expect(page.locator('#calcMetal')).toBeEnabled();
  });

  test('Pre-1933 coins are NOT 1099-B reportable', async ({ page }) => {
    const types = ['pre33_20', 'pre33_10', 'pre33_5', 'pre33_250'];
    for (const ct of types) {
      const result = await page.evaluate((coinType) => is1099BReportableProduct('gold', 'coins', coinType), ct);
      expect(result).toBe(false);
    }
  });

  test('Shared pre33 adjustment applies to all four denominations in pricing', async ({ page }) => {
    // Set a 2% pre-1933 adjustment
    const settingsWithAdj = {
      ...BASE_SETTINGS,
      coinAdjustments: { ...BASE_SETTINGS.coinAdjustments, pre33: 2 },
    };
    await seedAndReload(page, { settings: settingsWithAdj, transactions: [], customers: [], contacts: [] });
    await page.click('[data-page="calculator"]');

    const types = ['pre33_20', 'pre33_10', 'pre33_5', 'pre33_250'];
    for (const ct of types) {
      const margin = await page.evaluate((coinType) => getMargin('buy', 'coins', coinType), ct);
      // Base buy discount for coins is 3%, so margin = -0.03 - 0.02 = -0.05
      expect(margin).toBeCloseTo(-0.05, 5);
    }
  });

  test('Transaction logs correctly with pre-1933 coin type and displays in tx table', async ({ page }) => {
    await page.selectOption('#calcForm', 'coins');
    await page.selectOption('#calcCoinType', 'pre33_20');
    await page.fill('#calcQty', '5');
    await page.click('#logDealBtn');

    await expect(page.locator('#dealLoggedMsg')).toHaveClass(/show/);

    // Verify transaction in localStorage
    const tx = await page.evaluate(() => {
      const txs = JSON.parse(localStorage.getItem('st_transactions'));
      return txs[0];
    });
    expect(tx.coinType).toBe('pre33_20');

    // Close receipt modal if open, then navigate to transactions
    await page.locator('#receiptModal.open #receiptCloseBtn').click();
    await page.click('[data-page="transactions"]');
    const tableText = await page.locator('#txBody').textContent();
    expect(tableText).toContain('$20 Double Eagle');
  });

  test('Pre-1933 coin type shows correct label in receipt', async ({ page }) => {
    // Seed a pre-1933 transaction directly
    await seedAndReload(page, {
      settings: BASE_SETTINGS,
      transactions: [{
        id: 'tx-pre33-1', date: '2025-01-15T12:00:00Z', type: 'buy', metal: 'gold', form: 'coins',
        coinType: 'pre33_5', qty: 3, spot: 2500, price: 2425, total: 7275, profit: 225,
        payment: 'cash',
      }],
      customers: [],
      contacts: [],
    });

    await page.click('[data-page="transactions"]');
    await page.locator('#txBody tr').first().locator('button', { hasText: '🧾' }).click();
    await expect(page.locator('#receiptModal')).toHaveClass(/open/);

    const receiptText = await page.locator('#receiptContent').textContent();
    expect(receiptText).toContain('$5 Half Eagle');
  });
});

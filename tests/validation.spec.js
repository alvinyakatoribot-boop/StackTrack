const { test, expect } = require('@playwright/test');

const TEST_DATA = {
  settings: {
    shopName: 'Test Bullion Shop',
    sellPremCoins: 7, sellPremBars: 5, sellPremScrap: 3,
    buyDiscCoins: 3, buyDiscBars: 5, buyDiscScrap: 8,
    whDiscCoins: 1, whDiscBars: 2, whDiscScrap: 3,
    coinAdjustments: { eagles: 0, maples: 0, krugerrands: 0, britannias: 0, philharmonics: 0 },
    junkDivisor: 1.3, junkMultOverride: null,
    threshGold: 10, threshSilver: 500,
  },
  transactions: [
    {
      id: 'tx-val-1',
      date: '2025-01-15T12:00:00Z',
      type: 'buy',
      metal: 'gold',
      form: 'coins',
      coinType: 'eagles',
      qty: 2,
      spot: 2000,
      price: 1940,
      total: 3880,
      profit: 120,
      payment: 'cash',
      customerId: 'cust-val-1',
      notes: '',
    },
  ],
  customers: [
    { id: 'cust-val-1', name: 'Val Customer', email: 'val@example.com', phone: '' },
  ],
  contacts: [],
};

/** Mock the gold-api.com spot price endpoints. */
async function mockSpotPrices(page, { gold = 2500, silver = 32 } = {}) {
  await page.route('**/api.gold-api.com/price/XAU', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ price: gold }) }),
  );
  await page.route('**/api.gold-api.com/price/XAG', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ price: silver }) }),
  );
}

/** Seed localStorage and reload so the app picks up the data. */
async function seedAndReload(page) {
  await page.evaluate((data) => {
    localStorage.setItem('st_settings', JSON.stringify(data.settings));
    localStorage.setItem('st_transactions', JSON.stringify(data.transactions));
    localStorage.setItem('st_customers', JSON.stringify(data.customers));
    localStorage.setItem('st_contacts', JSON.stringify(data.contacts));
  }, TEST_DATA);
  await page.reload();
  // Wait for spot prices to load
  await page.waitForFunction(() => {
    const el = document.getElementById('outSpot');
    return el && !el.textContent.includes('$0.00');
  }, { timeout: 5000 });
}

// ─── Calculator Validation ───────────────────────────────────────────

test.describe('Calculator — Log Deal validation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page);
    await page.click('[data-page="calculator"]');
  });

  test('blocks logging when quantity is zero', async ({ page }) => {
    await page.fill('#calcQty', '0');

    // Button should be disabled, preventing any deal from being logged
    await expect(page.locator('#logDealBtn')).toBeDisabled();

    // Force-click to verify the JS guard also prevents it
    await page.click('#logDealBtn', { force: true });

    const count = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('st_transactions')).length,
    );
    expect(count).toBe(1);
  });

  test('blocks logging when spot price is unavailable', async ({ page }) => {
    // Force spot to 0
    await page.evaluate(() => {
      spotPrices.gold = 0;
      spotPrices.silver = 0;
    });

    await page.fill('#calcQty', '5');

    page.on('dialog', dialog => dialog.dismiss());
    await page.click('#logDealBtn');

    const count = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('st_transactions')).length,
    );
    expect(count).toBe(1);
  });

  test('successfully logs a valid deal', async ({ page }) => {
    await page.fill('#calcQty', '3');
    await page.click('#logDealBtn');

    const count = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('st_transactions')).length,
    );
    expect(count).toBe(2);
  });
});

// ─── Edit Modal Validation ───────────────────────────────────────────

test.describe('Edit Modal — Save validation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page);

    // Navigate to transactions and open the edit modal for tx-val-1
    await page.click('[data-page="transactions"]');
    await page.locator('#txBody tr').first().locator('button', { hasText: '✏️' }).click();
    await expect(page.locator('#editModal')).toHaveClass(/open/);
  });

  test('rejects save when quantity is zero', async ({ page }) => {
    page.on('dialog', async dialog => {
      expect(dialog.message()).toContain('Quantity');
      await dialog.dismiss();
    });

    await page.fill('#editQty', '0');
    await page.click('#editSaveBtn');

    // Modal should still be open (save rejected)
    await expect(page.locator('#editModal')).toHaveClass(/open/);
  });

  test('rejects save when spot price is zero', async ({ page }) => {
    page.on('dialog', async dialog => {
      expect(dialog.message()).toContain('Spot');
      await dialog.dismiss();
    });

    await page.fill('#editSpot', '0');
    await page.click('#editSaveBtn');

    await expect(page.locator('#editModal')).toHaveClass(/open/);
  });

  test('rejects save when price is zero', async ({ page }) => {
    page.on('dialog', async dialog => {
      expect(dialog.message()).toContain('Price');
      await dialog.dismiss();
    });

    await page.fill('#editPrice', '0');
    await page.click('#editSaveBtn');

    await expect(page.locator('#editModal')).toHaveClass(/open/);
  });

  test('rejects save when quantity is negative', async ({ page }) => {
    page.on('dialog', async dialog => {
      expect(dialog.message()).toContain('Quantity');
      await dialog.dismiss();
    });

    await page.fill('#editQty', '-5');
    await page.click('#editSaveBtn');

    await expect(page.locator('#editModal')).toHaveClass(/open/);
  });

  test('saves successfully with valid values', async ({ page }) => {
    await page.fill('#editQty', '10');
    await page.fill('#editSpot', '2100');
    await page.fill('#editPrice', '2050');
    await page.click('#editSaveBtn');

    // Modal should close
    await expect(page.locator('#editModal')).not.toHaveClass(/open/);

    // Verify the transaction was updated in localStorage
    const tx = await page.evaluate(() => {
      const txs = JSON.parse(localStorage.getItem('st_transactions'));
      return txs.find(t => t.id === 'tx-val-1');
    });
    expect(tx.qty).toBe(10);
    expect(tx.spot).toBe(2100);
    expect(tx.price).toBe(2050);
  });
});

// ─── Settings Validation ─────────────────────────────────────────────

test.describe('Settings — Save validation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page);
    await page.click('[data-page="settings"]');
  });

  test('clamps negative premium values to zero', async ({ page }) => {
    await page.fill('#sellPremCoins', '-5');
    await page.fill('#buyDiscBars', '-10');
    await page.click('#saveSettingsBtn');

    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('st_settings')),
    );
    expect(saved.sellPremCoins).toBe(0);
    expect(saved.buyDiscBars).toBe(0);
  });

  test('falls back to 1.3 when junkDivisor is zero', async ({ page }) => {
    await page.fill('#junkDivisor', '0');
    await page.click('#saveSettingsBtn');

    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('st_settings')),
    );
    expect(saved.junkDivisor).toBe(1.3);
  });

  test('falls back to 1.3 when junkDivisor is negative', async ({ page }) => {
    await page.fill('#junkDivisor', '-2');
    await page.click('#saveSettingsBtn');

    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('st_settings')),
    );
    expect(saved.junkDivisor).toBe(1.3);
  });

  test('accepts valid positive junkDivisor', async ({ page }) => {
    await page.fill('#junkDivisor', '1.5');
    await page.click('#saveSettingsBtn');

    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('st_settings')),
    );
    expect(saved.junkDivisor).toBe(1.5);
  });

  test('clamps negative threshold values to zero', async ({ page }) => {
    await page.fill('#threshGold', '-1');
    await page.fill('#threshSilver', '-100');
    await page.click('#saveSettingsBtn');

    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('st_settings')),
    );
    expect(saved.threshGold).toBe(0);
    expect(saved.threshSilver).toBe(0);
  });

  test('clamps negative coin adjustments to zero', async ({ page }) => {
    await page.fill('#adjEagles', '-3');
    await page.click('#saveSettingsBtn');

    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('st_settings')),
    );
    expect(saved.coinAdjustments.eagles).toBe(0);
  });
});

// ─── Junk Silver Inventory ───────────────────────────────────────────

test.describe('Junk silver inventory uses configurable divisor', () => {
  test('inventory reflects junkDivisor setting', async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page, { gold: 2500, silver: 32 });

    // Seed with a junk silver transaction and a custom divisor
    const data = {
      ...TEST_DATA,
      settings: { ...TEST_DATA.settings, junkDivisor: 1.4 },
      transactions: [
        {
          id: 'tx-junk-1',
          date: '2025-01-15T12:00:00Z',
          type: 'buy',
          metal: 'silver',
          form: 'junk',
          qty: 14,
          spot: 32,
          price: 24,
          total: 336,
          profit: 0,
          payment: 'cash',
        },
      ],
    };

    await page.evaluate((d) => {
      localStorage.setItem('st_settings', JSON.stringify(d.settings));
      localStorage.setItem('st_transactions', JSON.stringify(d.transactions));
      localStorage.setItem('st_customers', JSON.stringify([]));
      localStorage.setItem('st_contacts', JSON.stringify([]));
    }, data);
    await page.reload();

    // Read the junk oz value from inventory via JS (14 / 1.4 = 10)
    const junkOz = await page.evaluate(() => {
      const settings = JSON.parse(localStorage.getItem('st_settings'));
      const txs = JSON.parse(localStorage.getItem('st_transactions'));
      return txs.reduce((sum, tx) => {
        if (tx.form === 'junk' && tx.type === 'buy') return sum + tx.qty / settings.junkDivisor;
        return sum;
      }, 0);
    });
    expect(junkOz).toBeCloseTo(10, 5);
  });
});

const { test, expect } = require('@playwright/test');

const BASE_SETTINGS = {
  shopName: 'Test Bullion Shop',
  sellPremCoins: 7, sellPremBars: 5, sellPremScrap: 3,
  buyDiscCoins: 3, buyDiscBars: 5, buyDiscScrap: 8,
  whDiscCoins: 1, whDiscBars: 2, whDiscScrap: 3,
  coinAdjustments: { eagles: 0, maples: 0, krugerrands: 0, britannias: 0, philharmonics: 0 },
  junkDivisor: 1.3, junkMultOverride: null,
  threshGold: 10, threshSilver: 500,
  reorderPoints: {
    goldCoins: 0, goldBars: 0, goldRounds: 0, goldScrap: 0,
    silverCoins: 0, silverBars: 0, silverRounds: 0, silverJunk: 0, silverScrap: 0
  }
};

function makeTx(overrides) {
  return {
    id: 'tx-' + Math.random().toString(36).slice(2, 8),
    date: '2025-01-15T12:00:00Z',
    type: 'buy',
    metal: 'gold',
    form: 'coins',
    coinType: '',
    qty: 5,
    spot: 2000,
    price: 1950,
    total: 9750,
    profit: 250,
    payment: 'cash',
    customerId: '',
    notes: '',
    ...overrides,
  };
}

async function mockSpotPrices(page, { gold = 2500, silver = 32 } = {}) {
  await page.route('**/api.gold-api.com/price/XAU', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ price: gold }) }),
  );
  await page.route('**/api.gold-api.com/price/XAG', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ price: silver }) }),
  );
}

async function seedAndReload(page, { settings, transactions = [], customers = [], contacts = [] }) {
  await page.evaluate((data) => {
    localStorage.setItem('st_settings', JSON.stringify(data.settings));
    localStorage.setItem('st_transactions', JSON.stringify(data.transactions));
    localStorage.setItem('st_customers', JSON.stringify(data.customers));
    localStorage.setItem('st_contacts', JSON.stringify(data.contacts));
  }, { settings, transactions, customers, contacts });
  await page.reload();
  await page.waitForLoadState('networkidle');
}

async function goToInventory(page) {
  await page.click('[data-page="inventory"]');
  await page.waitForSelector('#page-inventory', { state: 'visible' });
}

async function goToSettings(page) {
  await page.click('[data-page="settings"]');
  await page.waitForSelector('#page-settings', { state: 'visible' });
}

test.describe('Inventory Reorder Alerts', () => {
  test.beforeEach(async ({ page }) => {
    await mockSpotPrices(page);
    await page.goto('/');
    await page.waitForLoadState('networkidle');
  });

  // ─── Settings: defaults ───

  test('reorder points default to 0', async ({ page }) => {
    await seedAndReload(page, { settings: { ...BASE_SETTINGS } });
    await goToSettings(page);

    const inputs = [
      'reorderGoldCoins', 'reorderGoldBars', 'reorderGoldRounds', 'reorderGoldScrap',
      'reorderSilverCoins', 'reorderSilverBars', 'reorderSilverRounds', 'reorderSilverJunk', 'reorderSilverScrap'
    ];
    for (const id of inputs) {
      await expect(page.locator(`#${id}`)).toHaveValue('0');
    }
  });

  test('save and load reorder points', async ({ page }) => {
    await seedAndReload(page, { settings: { ...BASE_SETTINGS } });
    await goToSettings(page);

    await page.fill('#reorderGoldCoins', '5');
    await page.fill('#reorderSilverBars', '100');
    await page.click('#saveSettingsBtn');

    // Reload and verify persistence
    await page.reload();
    await page.waitForLoadState('networkidle');
    await goToSettings(page);

    await expect(page.locator('#reorderGoldCoins')).toHaveValue('5');
    await expect(page.locator('#reorderSilverBars')).toHaveValue('100');
    await expect(page.locator('#reorderGoldBars')).toHaveValue('0');
  });

  test('reorder points are stored in settings object', async ({ page }) => {
    const customSettings = {
      ...BASE_SETTINGS,
      reorderPoints: { ...BASE_SETTINGS.reorderPoints, goldCoins: 3, silverRounds: 50 }
    };
    await seedAndReload(page, { settings: customSettings });
    await goToSettings(page);

    await expect(page.locator('#reorderGoldCoins')).toHaveValue('3');
    await expect(page.locator('#reorderSilverRounds')).toHaveValue('50');
  });

  // ─── Inventory page: low-stock indicators ───

  test('low-stock class on breakdown row when below reorder point', async ({ page }) => {
    const settings = {
      ...BASE_SETTINGS,
      reorderPoints: { ...BASE_SETTINGS.reorderPoints, goldCoins: 10 }
    };
    const transactions = [makeTx({ metal: 'gold', form: 'coins', qty: 5 })];
    await seedAndReload(page, { settings, transactions });
    await goToInventory(page);

    const lowStockRows = page.locator('#invGoldBreakdown .breakdown-row.low-stock');
    await expect(lowStockRows).toHaveCount(1);
  });

  test('no low-stock class when above reorder point', async ({ page }) => {
    const settings = {
      ...BASE_SETTINGS,
      reorderPoints: { ...BASE_SETTINGS.reorderPoints, goldCoins: 3 }
    };
    const transactions = [makeTx({ metal: 'gold', form: 'coins', qty: 5 })];
    await seedAndReload(page, { settings, transactions });
    await goToInventory(page);

    const lowStockRows = page.locator('#invGoldBreakdown .breakdown-row.low-stock');
    await expect(lowStockRows).toHaveCount(0);
  });

  test('no low-stock class when reorder point is 0 (disabled)', async ({ page }) => {
    const settings = {
      ...BASE_SETTINGS,
      reorderPoints: { ...BASE_SETTINGS.reorderPoints, goldCoins: 0 }
    };
    const transactions = [makeTx({ metal: 'gold', form: 'coins', qty: 1 })];
    await seedAndReload(page, { settings, transactions });
    await goToInventory(page);

    const lowStockRows = page.locator('#invGoldBreakdown .breakdown-row.low-stock');
    await expect(lowStockRows).toHaveCount(0);
  });

  test('red dot appears on low-stock breakdown row', async ({ page }) => {
    const settings = {
      ...BASE_SETTINGS,
      reorderPoints: { ...BASE_SETTINGS.reorderPoints, goldBars: 10 }
    };
    const transactions = [makeTx({ metal: 'gold', form: 'bars', qty: 3 })];
    await seedAndReload(page, { settings, transactions });
    await goToInventory(page);

    const dot = page.locator('#invGoldBreakdown .breakdown-row.low-stock .reorder-dot');
    await expect(dot).toHaveCount(1);
  });

  test('no red dot when above threshold', async ({ page }) => {
    const settings = {
      ...BASE_SETTINGS,
      reorderPoints: { ...BASE_SETTINGS.reorderPoints, goldBars: 2 }
    };
    const transactions = [makeTx({ metal: 'gold', form: 'bars', qty: 5 })];
    await seedAndReload(page, { settings, transactions });
    await goToInventory(page);

    const dot = page.locator('#invGoldBreakdown .reorder-dot');
    await expect(dot).toHaveCount(0);
  });

  // ─── Reorder alerts card ───

  test('reorder alerts card shows low items', async ({ page }) => {
    const settings = {
      ...BASE_SETTINGS,
      reorderPoints: { ...BASE_SETTINGS.reorderPoints, goldCoins: 10, silverBars: 50 }
    };
    const transactions = [
      makeTx({ metal: 'gold', form: 'coins', qty: 3 }),
      makeTx({ metal: 'silver', form: 'bars', qty: 20 }),
    ];
    await seedAndReload(page, { settings, transactions });
    await goToInventory(page);

    const alertItems = page.locator('#invReorderList .reorder-alert-item');
    await expect(alertItems).toHaveCount(2);

    const text = await page.locator('#invReorderList').textContent();
    expect(text).toContain('Gold Coins');
    expect(text).toContain('reorder point');
    expect(text).toContain('Silver Bars');
  });

  test('reorder alerts card shows empty state when all above threshold', async ({ page }) => {
    const settings = {
      ...BASE_SETTINGS,
      reorderPoints: { ...BASE_SETTINGS.reorderPoints, goldCoins: 2 }
    };
    const transactions = [makeTx({ metal: 'gold', form: 'coins', qty: 5 })];
    await seedAndReload(page, { settings, transactions });
    await goToInventory(page);

    await expect(page.locator('#invReorderEmpty')).toBeVisible();
    await expect(page.locator('#invReorderList .reorder-alert-item')).toHaveCount(0);
  });

  test('reorder alerts card shows empty state when all thresholds are 0', async ({ page }) => {
    const settings = { ...BASE_SETTINGS };
    const transactions = [makeTx({ metal: 'gold', form: 'coins', qty: 1 })];
    await seedAndReload(page, { settings, transactions });
    await goToInventory(page);

    await expect(page.locator('#invReorderEmpty')).toBeVisible();
  });

  test('reorder alerts card empty state text is correct', async ({ page }) => {
    await seedAndReload(page, { settings: { ...BASE_SETTINGS } });
    await goToInventory(page);

    const emptyText = await page.locator('#invReorderEmpty').textContent();
    expect(emptyText).toBe('All inventory levels are above reorder points.');
  });

  test('reorder alert item includes current and threshold values', async ({ page }) => {
    const settings = {
      ...BASE_SETTINGS,
      reorderPoints: { ...BASE_SETTINGS.reorderPoints, goldRounds: 8 }
    };
    const transactions = [makeTx({ metal: 'gold', form: 'rounds', qty: 2 })];
    await seedAndReload(page, { settings, transactions });
    await goToInventory(page);

    const text = await page.locator('#invReorderList .reorder-alert-item').first().textContent();
    expect(text).toContain('2.000 oz');
    expect(text).toContain('8.000 oz');
  });

  // ─── Silver forms ───

  test('silver junk form triggers low-stock correctly', async ({ page }) => {
    const settings = {
      ...BASE_SETTINGS,
      reorderPoints: { ...BASE_SETTINGS.reorderPoints, silverJunk: 100 }
    };
    // junk qty is divided by junkDivisor (1.3) -> 10/1.3 = ~7.69 oz
    const transactions = [makeTx({ metal: 'silver', form: 'junk', qty: 10 })];
    await seedAndReload(page, { settings, transactions });
    await goToInventory(page);

    const lowStockRows = page.locator('#invSilverBreakdown .breakdown-row.low-stock');
    await expect(lowStockRows).toHaveCount(1);
  });

  // ─── Alert banner ───

  test('alert banner includes low-stock count', async ({ page }) => {
    const settings = {
      ...BASE_SETTINGS,
      reorderPoints: { ...BASE_SETTINGS.reorderPoints, goldCoins: 10, goldBars: 10 }
    };
    const transactions = [
      makeTx({ metal: 'gold', form: 'coins', qty: 3 }),
      makeTx({ metal: 'gold', form: 'bars', qty: 2 }),
    ];
    await seedAndReload(page, { settings, transactions });

    const bannerText = await page.locator('#alertText').textContent();
    expect(bannerText).toContain('2 product(s) below reorder point');
  });

  test('alert banner does not include low-stock when all above threshold', async ({ page }) => {
    const settings = {
      ...BASE_SETTINGS,
      reorderPoints: { ...BASE_SETTINGS.reorderPoints, goldCoins: 1 }
    };
    const transactions = [makeTx({ metal: 'gold', form: 'coins', qty: 5 })];
    await seedAndReload(page, { settings, transactions });

    const bannerText = await page.locator('#alertText').textContent();
    expect(bannerText).not.toContain('below reorder point');
  });

  test('alert banner shows single product low-stock', async ({ page }) => {
    const settings = {
      ...BASE_SETTINGS,
      reorderPoints: { ...BASE_SETTINGS.reorderPoints, silverScrap: 50 }
    };
    const transactions = [makeTx({ metal: 'silver', form: 'scrap', qty: 10 })];
    await seedAndReload(page, { settings, transactions });

    const bannerText = await page.locator('#alertText').textContent();
    expect(bannerText).toContain('1 product(s) below reorder point');
  });

  // ─── Multiple metals with mixed states ───

  test('mixed low-stock and above-threshold across metals', async ({ page }) => {
    const settings = {
      ...BASE_SETTINGS,
      reorderPoints: {
        ...BASE_SETTINGS.reorderPoints,
        goldCoins: 10,   // below: qty=3
        goldBars: 1,     // above: qty=5
        silverRounds: 50 // below: qty=20
      }
    };
    const transactions = [
      makeTx({ metal: 'gold', form: 'coins', qty: 3 }),
      makeTx({ metal: 'gold', form: 'bars', qty: 5 }),
      makeTx({ metal: 'silver', form: 'rounds', qty: 20 }),
    ];
    await seedAndReload(page, { settings, transactions });
    await goToInventory(page);

    // Gold: coins should be low, bars should not
    const goldLow = page.locator('#invGoldBreakdown .breakdown-row.low-stock');
    await expect(goldLow).toHaveCount(1);

    // Silver: rounds should be low
    const silverLow = page.locator('#invSilverBreakdown .breakdown-row.low-stock');
    await expect(silverLow).toHaveCount(1);

    // Reorder card should show 2 items
    const alertItems = page.locator('#invReorderList .reorder-alert-item');
    await expect(alertItems).toHaveCount(2);
  });

  // ─── Breakdown row low-stock class removed after settings change ───

  test('low-stock indicators update after settings change', async ({ page }) => {
    const settings = {
      ...BASE_SETTINGS,
      reorderPoints: { ...BASE_SETTINGS.reorderPoints, goldCoins: 10 }
    };
    const transactions = [makeTx({ metal: 'gold', form: 'coins', qty: 5 })];
    await seedAndReload(page, { settings, transactions });
    await goToInventory(page);

    // Initially low-stock
    await expect(page.locator('#invGoldBreakdown .breakdown-row.low-stock')).toHaveCount(1);

    // Change reorder point to below current inventory
    await goToSettings(page);
    await page.fill('#reorderGoldCoins', '3');
    await page.click('#saveSettingsBtn');

    await goToInventory(page);
    await expect(page.locator('#invGoldBreakdown .breakdown-row.low-stock')).toHaveCount(0);
  });
});

const { test, expect } = require('@playwright/test');

const TEST_DATA = {
  settings: {
    shopName: 'Test Bullion Shop',
    sellPremCoins: 7, sellPremBars: 5, sellPremScrap: 3,
    buyDiscCoins: 3, buyDiscBars: 5, buyDiscScrap: 8,
    whDiscCoins: 1, whDiscBars: 2, whDiscScrap: 3,
    coinAdjustments: { eagles: 0, maples: 0, krugerrands: 0, britannias: 0, philharmonics: 0 },
    junkMultiplier: 0.715, junkMultOverride: null,
    sellPremJunk: 7, buyDiscJunk: 3, whDiscJunk: 1,
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

  test('falls back to 0.715 when junkMultiplier is zero', async ({ page }) => {
    await page.fill('#junkMultiplier', '0');
    await page.click('#saveSettingsBtn');

    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('st_settings')),
    );
    expect(saved.junkMultiplier).toBe(0.715);
  });

  test('falls back to 0.715 when junkMultiplier is negative', async ({ page }) => {
    await page.fill('#junkMultiplier', '-2');
    await page.click('#saveSettingsBtn');

    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('st_settings')),
    );
    expect(saved.junkMultiplier).toBe(0.715);
  });

  test('accepts valid positive junkMultiplier', async ({ page }) => {
    await page.fill('#junkMultiplier', '0.8');
    await page.click('#saveSettingsBtn');

    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('st_settings')),
    );
    expect(saved.junkMultiplier).toBe(0.8);
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

test.describe('Junk silver inventory uses configurable multiplier', () => {
  test('inventory reflects junkMultiplier setting', async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page, { gold: 2500, silver: 32 });

    // Seed with a junk silver transaction and a custom multiplier
    const data = {
      ...TEST_DATA,
      settings: { ...TEST_DATA.settings, junkMultiplier: 0.715 },
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

    // Read the junk oz value from inventory via JS (14 * 0.715 = 10.01)
    const junkOz = await page.evaluate(() => {
      const settings = JSON.parse(localStorage.getItem('st_settings'));
      const txs = JSON.parse(localStorage.getItem('st_transactions'));
      return txs.reduce((sum, tx) => {
        if (tx.form === 'junk' && tx.type === 'buy') return sum + tx.qty * settings.junkMultiplier;
        return sum;
      }, 0);
    });
    expect(junkOz).toBeCloseTo(14 * 0.715, 5);
  });
});

// ─── Scrap Karat Calculator ─────────────────────────────────────────

test.describe('Scrap karat calculator', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page);
    await page.click('[data-page="calculator"]');
  });

  test('selecting scrap form shows purity and weight unit dropdowns', async ({ page }) => {
    await page.selectOption('#calcForm', 'scrap');
    await expect(page.locator('#scrapPurityGroup')).toBeVisible();
    await expect(page.locator('#scrapWeightUnitGroup')).toBeVisible();
  });

  test('switching metal updates purity options (gold vs silver)', async ({ page }) => {
    await page.selectOption('#calcForm', 'scrap');

    // Gold should show karat options
    await page.selectOption('#calcMetal', 'gold');
    const goldOptions = await page.locator('#scrapPurity option').allTextContents();
    expect(goldOptions.some(o => o.includes('14K'))).toBe(true);
    expect(goldOptions.some(o => o.includes('Sterling'))).toBe(false);

    // Silver should show silver purity options
    await page.selectOption('#calcMetal', 'silver');
    const silverOptions = await page.locator('#scrapPurity option').allTextContents();
    expect(silverOptions.some(o => o.includes('Sterling'))).toBe(true);
    expect(silverOptions.some(o => o.includes('14K'))).toBe(false);
  });

  test('quantity label shows fine troy oz conversion', async ({ page }) => {
    await page.selectOption('#calcForm', 'scrap');
    await page.selectOption('#calcMetal', 'gold');
    await page.selectOption('#scrapPurity', '14k');
    await page.selectOption('#scrapWeightUnit', 'g');
    await page.fill('#calcQty', '31.1035');

    // 31.1035g = 1 troy oz * 14/24 fineness ≈ 0.583 fine toz
    const label = await page.locator('#qtyLabel').textContent();
    expect(label).toContain('fine toz');
    expect(label).toContain('0.583');
  });

  test('logging 14K gold scrap stores correct fine oz, purity, and rawQty', async ({ page }) => {
    await page.selectOption('#calcForm', 'scrap');
    await page.selectOption('#calcMetal', 'gold');
    await page.selectOption('#scrapPurity', '14k');
    await page.selectOption('#scrapWeightUnit', 'g');
    await page.fill('#calcQty', '15.5');
    await page.click('#logDealBtn');

    // Wait for the transaction to be logged
    await page.waitForFunction(() => {
      const txs = JSON.parse(localStorage.getItem('st_transactions'));
      return txs.length > 1;
    }, { timeout: 3000 });

    const tx = await page.evaluate(() => {
      const txs = JSON.parse(localStorage.getItem('st_transactions'));
      return txs.find(t => t.form === 'scrap');
    });

    // 15.5g → troy oz → fine oz: 15.5 / 31.1035 * (14/24)
    const expectedFineOz = 15.5 / 31.1035 * (14 / 24);
    expect(tx.qty).toBeCloseTo(expectedFineOz, 3);
    expect(tx.scrapPurity).toBe('14k');
    expect(tx.scrapWeightUnit).toBe('g');
    expect(tx.rawQty).toBe(15.5);
  });

  test('inventory correctly reflects fine oz for scrap', async ({ page }) => {
    await page.selectOption('#calcForm', 'scrap');
    await page.selectOption('#calcMetal', 'gold');
    await page.selectOption('#scrapPurity', '14k');
    await page.selectOption('#scrapWeightUnit', 'g');
    await page.fill('#calcQty', '31.1035');
    await page.click('#logDealBtn');

    const inv = await page.evaluate(() => {
      const txs = JSON.parse(localStorage.getItem('st_transactions'));
      let scrapOz = 0;
      txs.forEach(tx => {
        if (tx.form === 'scrap' && tx.type === 'buy') scrapOz += tx.qty;
      });
      return scrapOz;
    });

    // 31.1035g = 1 toz * 14/24 fineness
    expect(inv).toBeCloseTo(14 / 24, 3);
  });

  test('purity dropdown hidden when switching away from scrap', async ({ page }) => {
    await page.selectOption('#calcForm', 'scrap');
    await expect(page.locator('#scrapPurityGroup')).toBeVisible();

    await page.selectOption('#calcForm', 'bars');
    await expect(page.locator('#scrapPurityGroup')).not.toBeVisible();
    await expect(page.locator('#scrapWeightUnitGroup')).not.toBeVisible();
  });
});

// ─── Weight Unit Selector ────────────────────────────────────────────

test.describe('Weight unit selector', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page);
    await page.click('[data-page="calculator"]');
  });

  test('weight unit dropdown visible for bars, hidden for junk and pre-1933', async ({ page }) => {
    // Bars — should be visible
    await page.selectOption('#calcForm', 'bars');
    await expect(page.locator('#weightUnitGroup')).toBeVisible();

    // Rounds — should be visible
    await page.selectOption('#calcForm', 'rounds');
    await expect(page.locator('#weightUnitGroup')).toBeVisible();

    // Coins (modern) — should be visible
    await page.selectOption('#calcForm', 'coins');
    await page.selectOption('#calcCoinType', 'eagles');
    await expect(page.locator('#weightUnitGroup')).toBeVisible();

    // Junk — should be hidden
    await page.selectOption('#calcForm', 'junk');
    await expect(page.locator('#weightUnitGroup')).not.toBeVisible();

    // Scrap — should be hidden (scrap has its own weight unit)
    await page.selectOption('#calcForm', 'scrap');
    await expect(page.locator('#weightUnitGroup')).not.toBeVisible();
  });

  test('weight unit dropdown hidden for pre-1933 coins', async ({ page }) => {
    await page.selectOption('#calcForm', 'coins');
    await page.selectOption('#calcCoinType', 'eagles');
    await expect(page.locator('#weightUnitGroup')).toBeVisible();

    await page.selectOption('#calcCoinType', 'pre33_20');
    await expect(page.locator('#weightUnitGroup')).not.toBeVisible();
  });

  test('quantity label shows troy oz conversion when grams selected', async ({ page }) => {
    await page.selectOption('#calcForm', 'bars');
    await page.selectOption('#calcWeightUnit', 'g');
    await page.fill('#calcQty', '31.1035');

    const label = await page.textContent('#qtyLabel');
    expect(label).toContain('toz');
    expect(label).toContain('1.000');
  });

  test('logging a deal in grams stores correct troy oz qty, weightUnit, and rawQty', async ({ page }) => {
    await page.selectOption('#calcForm', 'bars');
    await page.selectOption('#calcWeightUnit', 'g');
    await page.fill('#calcQty', '10');

    // Dismiss any alert dialogs (e.g., receipt)
    page.on('dialog', dialog => dialog.dismiss());
    await page.click('#logDealBtn');

    const tx = await page.evaluate(() => {
      const txs = JSON.parse(localStorage.getItem('st_transactions'));
      return txs.find(t => t.id !== 'tx-val-1');
    });

    expect(tx).toBeTruthy();
    // 10g = 10 / 31.1035 troy oz
    expect(tx.qty).toBeCloseTo(10 / 31.1035, 3);
    expect(tx.weightUnit).toBe('g');
    expect(tx.rawQty).toBe(10);
    expect(tx.lines[0].qty).toBeCloseTo(10 / 31.1035, 3);
    expect(tx.lines[0].weightUnit).toBe('g');
    expect(tx.lines[0].rawQty).toBe(10);
  });
});

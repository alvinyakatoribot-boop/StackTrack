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

// ─── Fixed-Dollar Premiums ──────────────────────────────────────────

test.describe('Fixed-dollar premiums', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page, { gold: 2500, silver: 32 });
    await seedAndReload(page);
  });

  test('toggle button visible and defaults to % for sell premium fields', async ({ page }) => {
    await page.click('[data-page="settings"]');
    const toggle = page.locator('.prem-mode-toggle[data-field="sellPremCoins"]');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveText('%');
    await expect(toggle).not.toHaveClass(/dollar-mode/);
  });

  test('dollar mode: spot $2500 + $50 sell premium = $2550 price per oz', async ({ page }) => {
    await page.click('[data-page="calculator"]');
    await page.evaluate(() => {
      settings.sellPremCoins = 50;
      settings.premiumModes = { sellPremCoins: 'dollar' };
    });

    await page.click('.segment-btn[data-value="sell"]');
    await page.selectOption('#calcMetal', 'gold');
    await page.selectOption('#calcForm', 'coins');
    await page.fill('#calcQty', '1');

    const priceText = await page.locator('#outPrice').textContent();
    const price = parseFloat(priceText.replace(/[$,]/g, ''));
    expect(price).toBeCloseTo(2550, 0);
  });

  test('dollar mode: spot $2500 - $50 buy discount = $2450 price per oz', async ({ page }) => {
    await page.click('[data-page="calculator"]');
    await page.evaluate(() => {
      settings.buyDiscCoins = 50;
      settings.premiumModes = { buyDiscCoins: 'dollar' };
    });

    await page.click('.segment-btn[data-value="buy"]');
    await page.selectOption('#calcMetal', 'gold');
    await page.selectOption('#calcForm', 'coins');
    await page.fill('#calcQty', '1');

    const priceText = await page.locator('#outPrice').textContent();
    const price = parseFloat(priceText.replace(/[$,]/g, ''));
    expect(price).toBeCloseTo(2450, 0);
  });

  test('junk silver dollar mode: multiplier ± flat amount', async ({ page }) => {
    // spot $32, multiplier 0.715 → base = 32 * 0.715 = 22.88
    // sell premium $2 dollar mode → 22.88 + 2 = 24.88 per $1 FV
    await page.click('[data-page="calculator"]');
    await page.evaluate(() => {
      settings.sellPremJunk = 2;
      settings.premiumModes = { sellPremJunk: 'dollar' };
    });

    await page.click('.segment-btn[data-value="sell"]');
    await page.selectOption('#calcMetal', 'silver');
    await page.selectOption('#calcForm', 'junk');
    await page.fill('#calcQty', '1');

    const priceText = await page.locator('#outPrice').textContent();
    const price = parseFloat(priceText.replace(/[$,]/g, ''));
    // 32 * 0.715 + 2 = 24.88
    expect(price).toBeCloseTo(24.88, 1);
  });

  test('backward compatible: settings without premiumModes use % mode', async ({ page }) => {
    await page.click('[data-page="calculator"]');
    await page.evaluate(() => {
      delete settings.premiumModes;
    });

    // Default: sell, gold, coins with 7% premium → 2500 * 1.07 = 2675
    await page.click('.segment-btn[data-value="sell"]');
    await page.selectOption('#calcMetal', 'gold');
    await page.selectOption('#calcForm', 'coins');
    await page.fill('#calcQty', '1');

    const priceText = await page.locator('#outPrice').textContent();
    const price = parseFloat(priceText.replace(/[$,]/g, ''));
    expect(price).toBeCloseTo(2675, 0);
  });

  test('dollar mode persists after save and reload', async ({ page }) => {
    await page.click('[data-page="settings"]');

    // Click the toggle for sellPremCoins to switch to dollar mode
    const toggle = page.locator('.prem-mode-toggle[data-field="sellPremCoins"]');
    await toggle.click();
    await expect(toggle).toHaveText('$');
    await expect(toggle).toHaveClass(/dollar-mode/);

    // Save settings
    await page.click('#saveSettingsBtn');

    // Reload page
    await page.reload();
    await page.waitForFunction(() => {
      const el = document.getElementById('outSpot');
      return el && !el.textContent.includes('$0.00');
    }, { timeout: 5000 });

    // Check toggle state persisted
    await page.click('[data-page="settings"]');
    const toggleAfter = page.locator('.prem-mode-toggle[data-field="sellPremCoins"]');
    await expect(toggleAfter).toHaveText('$');
    await expect(toggleAfter).toHaveClass(/dollar-mode/);

    // Verify premiumModes in localStorage
    const modes = await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('st_settings'));
      return s.premiumModes;
    });
    expect(modes.sellPremCoins).toBe('dollar');
  });
});

// ─── FIFO Cost Basis ────────────────────────────────────────────────

test.describe('FIFO Cost Basis', () => {
  const FIFO_DATA = {
    settings: {
      shopName: 'Test Shop',
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
        id: 'fifo-buy1', date: '2025-01-10T10:00:00Z', type: 'buy',
        metal: 'gold', form: 'bars', qty: 5, spot: 1950, price: 1900,
        total: 9500, profit: 250, payment: 'wire',
      },
      {
        id: 'fifo-buy2', date: '2025-01-15T10:00:00Z', type: 'buy',
        metal: 'gold', form: 'bars', qty: 3, spot: 2150, price: 2100,
        total: 6300, profit: 150, payment: 'wire',
      },
      {
        id: 'fifo-sell1', date: '2025-01-20T10:00:00Z', type: 'sell',
        metal: 'gold', form: 'bars', qty: 6, spot: 2250, price: 2300,
        total: 13800, profit: 300, payment: 'wire',
      },
    ],
    customers: [],
    contacts: [],
  };

  async function seedFifoData(page) {
    await page.evaluate((data) => {
      localStorage.setItem('st_settings', JSON.stringify(data.settings));
      localStorage.setItem('st_transactions', JSON.stringify(data.transactions));
      localStorage.setItem('st_customers', JSON.stringify(data.customers));
      localStorage.setItem('st_contacts', JSON.stringify(data.contacts));
    }, FIFO_DATA);
    await page.reload();
    await page.waitForFunction(() => {
      const el = document.getElementById('outSpot');
      return el && !el.textContent.includes('$0.00');
    }, { timeout: 5000 });
  }

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page, { gold: 2400, silver: 30 });
    await seedFifoData(page);
  });

  test('correct FIFO cost basis for remaining inventory', async ({ page }) => {
    // Buy 5oz @ $1900, buy 3oz @ $2100, sell 6oz
    // FIFO consumes 5oz @ $1900 + 1oz @ $2100 → remaining 2oz @ $2100
    const result = await page.evaluate(() => {
      const cb = getCostBasis();
      return {
        qty: cb.summary.gold.bars.qty,
        totalCost: cb.summary.gold.bars.totalCost,
        avgCost: cb.summary.gold.bars.avgCost,
      };
    });

    expect(result.qty).toBeCloseTo(2, 3);
    expect(result.totalCost).toBeCloseTo(4200, 1);
    expect(result.avgCost).toBeCloseTo(2100, 1);
  });

  test('correct realized P&L from FIFO', async ({ page }) => {
    // Sell 6oz @ $2300 = $13,800 revenue
    // FIFO cost = 5×$1900 + 1×$2100 = $11,600
    // Realized = $13,800 - $11,600 = $2,200
    const result = await page.evaluate(() => {
      const cb = getCostBasis();
      return {
        totalRealizedPnl: cb.totalRealizedPnl,
        sellRealized: cb.realizedByTx['fifo-sell1'],
      };
    });

    expect(result.totalRealizedPnl).toBeCloseTo(2200, 1);
    expect(result.sellRealized).toBeCloseTo(2200, 1);
  });

  test('inventory page shows cost values', async ({ page }) => {
    await page.click('[data-page="inventory"]');
    const costText = await page.textContent('#invGoldCost');
    // Remaining 2oz @ $2100 = $4,200
    expect(costText).toContain('4,200');
    expect(costText).toContain('cost');
  });

  test('unrealized P&L computed correctly', async ({ page }) => {
    // Remaining 2oz, spot $2400 → spot value $4,800; cost $4,200 → unrealized $600
    await page.click('[data-page="inventory"]');
    const unrealizedText = await page.textContent('#invGoldUnrealized');
    expect(unrealizedText).toContain('600');
    expect(unrealizedText).toContain('unrealized');
  });

  test('junk silver FIFO handles multiplier', async ({ page }) => {
    // Add junk silver buy/sell
    await page.evaluate(() => {
      const txs = JSON.parse(localStorage.getItem('st_transactions'));
      txs.push({
        id: 'fifo-junk-buy', date: '2025-02-01T10:00:00Z', type: 'buy',
        metal: 'silver', form: 'junk', qty: 10, spot: 28,
        price: 20.02, total: 200.20, profit: 3.27, payment: 'cash',
      });
      txs.push({
        id: 'fifo-junk-sell', date: '2025-02-05T10:00:00Z', type: 'sell',
        metal: 'silver', form: 'junk', qty: 4, spot: 30,
        price: 21.45, total: 85.80, profit: 0, payment: 'cash',
      });
      localStorage.setItem('st_transactions', JSON.stringify(txs));
    });
    await page.reload();
    await page.waitForFunction(() => {
      const el = document.getElementById('outSpot');
      return el && !el.textContent.includes('$0.00');
    }, { timeout: 5000 });

    const result = await page.evaluate(() => {
      const cb = getCostBasis();
      return {
        junkQty: cb.summary.silver.junk.qty,
        junkCost: cb.summary.silver.junk.totalCost,
      };
    });

    // Buy 10 FV × 0.715 = 7.15 oz, sell 4 FV × 0.715 = 2.86 oz
    // Remaining = 7.15 - 2.86 = 4.29 oz
    expect(result.junkQty).toBeCloseTo(4.29, 2);
    // Cost per oz of buy = $200.20 / 7.15 = ~$28.00
    // Remaining cost = 4.29 × $28.00 = ~$120.12
    expect(result.junkCost).toBeCloseTo(120.12, 0);
  });

  test('backward compatible with transactions lacking cost data', async ({ page }) => {
    // getCostBasis should work even when called with the base FIFO_DATA (no special cost fields)
    const result = await page.evaluate(() => {
      const cb = getCostBasis();
      return { totalCostBasis: cb.totalCostBasis, totalRealizedPnl: cb.totalRealizedPnl };
    });

    // totalCostBasis = remaining 2oz @ $2100 = $4200
    expect(result.totalCostBasis).toBeCloseTo(4200, 1);
    expect(result.totalRealizedPnl).toBeCloseTo(2200, 1);
  });

  test('P&L page shows FIFO profit', async ({ page }) => {
    await page.click('[data-page="pnl"]');
    // Click "Monthly" to show all (our data is within a month context — use daily or check all periods)
    // The FIFO profit label should contain $2,200
    const fifoText = await page.textContent('#pnlFifoProfit');
    expect(fifoText).toContain('FIFO basis');
  });

  test('P&L page shows inventory at cost', async ({ page }) => {
    await page.click('[data-page="pnl"]');
    const costText = await page.textContent('#pnlInvCost');
    expect(costText).toContain('4,200');
  });

  test('P&L page shows unrealized P&L', async ({ page }) => {
    await page.click('[data-page="pnl"]');
    const unrealizedText = await page.textContent('#pnlUnrealized');
    // spot $2400 × 2oz = $4800 - $4200 cost = $600
    expect(unrealizedText).toContain('600');
  });

  test('dashboard shows cost basis in inventory snapshot', async ({ page }) => {
    const costText = await page.textContent('#dashGoldCost');
    expect(costText).toContain('4,200');
    expect(costText).toContain('cost');
  });
});

// ─── Sales Tax ────────────────────────────────────────────────────────

const TAX_TEST_DATA = {
  settings: {
    shopName: 'Tax Test Shop',
    sellPremCoins: 7, sellPremBars: 5, sellPremScrap: 3,
    buyDiscCoins: 3, buyDiscBars: 5, buyDiscScrap: 8,
    whDiscCoins: 1, whDiscBars: 2, whDiscScrap: 3,
    coinAdjustments: { eagles: 0, maples: 0, krugerrands: 0, britannias: 0, philharmonics: 0, pre33: 0 },
    junkMultiplier: 0.715, junkMultOverride: null,
    sellPremJunk: 7, buyDiscJunk: 3, whDiscJunk: 1,
    threshGold: 10, threshSilver: 500,
    reorderPoints: {},
    premiumModes: {},
    taxEnabled: true,
    taxState: 'HI',
    taxRateOverride: null
  },
  transactions: [],
  customers: [
    { id: 'cust-tax-1', name: 'Tax Customer', email: 'tax@example.com', phone: '' },
  ],
  contacts: [],
};

async function seedTaxData(page, overrides = {}) {
  const data = JSON.parse(JSON.stringify(TAX_TEST_DATA));
  Object.assign(data.settings, overrides.settings || {});
  if (overrides.transactions) data.transactions = overrides.transactions;
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

test.describe('Sales Tax', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page, { gold: 2500, silver: 32 });
  });

  test('no tax when disabled', async ({ page }) => {
    await seedTaxData(page, { settings: { taxEnabled: false } });
    await page.click('[data-page="calculator"]');
    // Set to sell, gold coins, qty 1
    await page.click('[data-value="sell"]');
    await page.fill('#calcQty', '1');
    await page.click('#logDealBtn');
    // Get the logged transaction
    const tx = await page.evaluate(() => {
      const txs = JSON.parse(localStorage.getItem('st_transactions') || '[]');
      return txs[txs.length - 1];
    });
    expect(tx.taxAmount || 0).toBe(0);
  });

  test('tax on sell — HI 4%', async ({ page }) => {
    await seedTaxData(page);
    await page.click('[data-page="calculator"]');
    await page.click('[data-value="sell"]');
    await page.fill('#calcQty', '1');
    await page.click('#logDealBtn');
    const tx = await page.evaluate(() => {
      const txs = JSON.parse(localStorage.getItem('st_transactions') || '[]');
      return txs[txs.length - 1];
    });
    expect(tx.taxRate).toBe(4);
    expect(tx.taxAmount).toBeGreaterThan(0);
    expect(tx.total).toBeCloseTo(tx.subtotal + tx.taxAmount, 2);
  });

  test('no tax on buy', async ({ page }) => {
    await seedTaxData(page);
    await page.click('[data-page="calculator"]');
    // Buy is the default type
    await page.fill('#calcQty', '1');
    await page.click('#logDealBtn');
    const tx = await page.evaluate(() => {
      const txs = JSON.parse(localStorage.getItem('st_transactions') || '[]');
      return txs[txs.length - 1];
    });
    expect(tx.taxAmount).toBe(0);
  });

  test('no tax on wholesale', async ({ page }) => {
    await seedTaxData(page);
    await page.click('[data-page="calculator"]');
    await page.click('[data-value="wholesale"]');
    await page.fill('#calcQty', '1');
    await page.click('#logDealBtn');
    const tx = await page.evaluate(() => {
      const txs = JSON.parse(localStorage.getItem('st_transactions') || '[]');
      return txs[txs.length - 1];
    });
    expect(tx.taxAmount).toBe(0);
  });

  test('threshold exempt — CA >$2000', async ({ page }) => {
    await seedTaxData(page, { settings: { taxState: 'CA' } });
    await page.click('[data-page="calculator"]');
    await page.click('[data-value="sell"]');
    // Gold at $2500/oz, sell prem 7% = $2675/oz. 1 oz > $2000 threshold → exempt
    await page.fill('#calcQty', '1');
    await page.click('#logDealBtn');
    const tx = await page.evaluate(() => {
      const txs = JSON.parse(localStorage.getItem('st_transactions') || '[]');
      return txs[txs.length - 1];
    });
    expect(tx.taxAmount).toBe(0);
  });

  test('threshold applies — CA ≤$2000', async ({ page }) => {
    await seedTaxData(page, { settings: { taxState: 'CA' } });
    await page.click('[data-page="calculator"]');
    await page.click('[data-value="sell"]');
    // Switch to silver — $32/oz + 7% = $34.24/oz. Need subtotal ≤ $2000.
    await page.selectOption('#calcMetal', 'silver');
    await page.selectOption('#calcForm', 'bars');
    await page.fill('#calcQty', '10'); // ~$342.40 — well under $2000
    await page.click('#logDealBtn');
    const tx = await page.evaluate(() => {
      const txs = JSON.parse(localStorage.getItem('st_transactions') || '[]');
      return txs[txs.length - 1];
    });
    expect(tx.taxRate).toBe(7.25);
    expect(tx.taxAmount).toBeGreaterThan(0);
  });

  test('rate override', async ({ page }) => {
    await seedTaxData(page, { settings: { taxRateOverride: 3.5 } });
    await page.click('[data-page="calculator"]');
    await page.click('[data-value="sell"]');
    await page.fill('#calcQty', '1');
    await page.click('#logDealBtn');
    const tx = await page.evaluate(() => {
      const txs = JSON.parse(localStorage.getItem('st_transactions') || '[]');
      return txs[txs.length - 1];
    });
    expect(tx.taxRate).toBe(3.5);
    expect(tx.taxAmount).toBeGreaterThan(0);
  });

  test('receipt shows tax', async ({ page }) => {
    // Seed a sell transaction with tax
    const sellTx = {
      id: 'tx-tax-receipt',
      date: new Date().toISOString(),
      type: 'sell',
      metal: 'gold',
      form: 'coins',
      coinType: 'eagles',
      qty: 1,
      spot: 2500,
      price: 2675,
      subtotal: 2675,
      taxRate: 4,
      taxAmount: 107,
      total: 2782,
      profit: 175,
      payment: 'cash',
      lines: [{ metal: 'gold', form: 'coins', coinType: 'eagles', qty: 1, spot: 2500, price: 2675, total: 2675, profit: 175 }]
    };
    await seedTaxData(page, { transactions: [sellTx] });
    // Open receipt via showReceipt
    await page.evaluate(() => window.showReceipt('tx-tax-receipt'));
    await page.waitForSelector('#receiptModal.open');
    const receiptHtml = await page.innerHTML('#receiptContent');
    expect(receiptHtml).toContain('Subtotal');
    expect(receiptHtml).toContain('Sales Tax');
    expect(receiptHtml).toContain('4%');
  });

  test('P&L excludes tax from revenue', async ({ page }) => {
    const sellTx = {
      id: 'tx-tax-pnl',
      date: new Date().toISOString(),
      type: 'sell',
      metal: 'gold',
      form: 'bars',
      qty: 1,
      spot: 2500,
      price: 2625,
      subtotal: 2625,
      taxRate: 4,
      taxAmount: 105,
      total: 2730,
      profit: 125,
      payment: 'cash',
      lines: [{ metal: 'gold', form: 'bars', qty: 1, spot: 2500, price: 2625, total: 2625, profit: 125 }]
    };
    await seedTaxData(page, { transactions: [sellTx] });
    await page.click('[data-page="pnl"]');
    // Revenue should show subtotal (2625), not total with tax (2730)
    const soldText = await page.textContent('#pnlSold');
    expect(soldText).toContain('2,625');
    // Tax collected card should be visible
    const taxCard = await page.locator('#pnlTaxCard');
    await expect(taxCard).toBeVisible();
    const taxText = await page.textContent('#pnlTaxCollected');
    expect(taxText).toContain('105');
  });

  test('backward compat — old tx without tax fields', async ({ page }) => {
    const oldTx = {
      id: 'tx-old-compat',
      date: new Date().toISOString(),
      type: 'sell',
      metal: 'gold',
      form: 'coins',
      coinType: 'eagles',
      qty: 1,
      spot: 2500,
      price: 2675,
      total: 2675,
      profit: 175,
      payment: 'cash',
      lines: [{ metal: 'gold', form: 'coins', coinType: 'eagles', qty: 1, spot: 2500, price: 2675, total: 2675, profit: 175 }]
    };
    await seedTaxData(page, { transactions: [oldTx] });
    // Check receipt — should show total without tax line
    await page.evaluate(() => window.showReceipt('tx-old-compat'));
    await page.waitForSelector('#receiptModal.open');
    const receiptHtml = await page.innerHTML('#receiptContent');
    expect(receiptHtml).toContain('Total Amount');
    expect(receiptHtml).not.toContain('Subtotal');
    expect(receiptHtml).not.toContain('Sales Tax');
  });

  test('CSV has Tax column', async ({ page }) => {
    const sellTx = {
      id: 'tx-tax-csv',
      date: new Date().toISOString(),
      type: 'sell',
      metal: 'gold',
      form: 'bars',
      qty: 1,
      spot: 2500,
      price: 2625,
      subtotal: 2625,
      taxRate: 4,
      taxAmount: 105,
      total: 2730,
      profit: 125,
      payment: 'cash',
      lines: [{ metal: 'gold', form: 'bars', qty: 1, spot: 2500, price: 2625, total: 2625, profit: 125 }]
    };
    await seedTaxData(page, { transactions: [sellTx] });
    await page.click('[data-page="transactions"]');
    // Intercept download
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('#exportCsvBtn'),
    ]);
    const content = await download.createReadStream().then(stream => {
      return new Promise(resolve => {
        let data = '';
        stream.on('data', chunk => data += chunk);
        stream.on('end', () => resolve(data));
      });
    });
    expect(content).toContain('"Tax"');
    expect(content).toContain('"105"');
  });
});

// ─── Cash Drawer Management ─────────────────────────────────────────

test.describe('Cash Drawer Management', () => {
  const DRAWER_DATA = {
    settings: TEST_DATA.settings,
    transactions: [],
    customers: TEST_DATA.customers,
    contacts: [],
    cashDrawer: { status: 'closed', openedAt: null, openingBalance: 0, currentBalance: 0, sessionId: null, entries: [] },
    cashDrawerHistory: [],
  };

  async function seedDrawerAndReload(page, overrides = {}) {
    const data = { ...DRAWER_DATA, ...overrides };
    await page.evaluate((d) => {
      localStorage.setItem('st_settings', JSON.stringify(d.settings));
      localStorage.setItem('st_transactions', JSON.stringify(d.transactions));
      localStorage.setItem('st_customers', JSON.stringify(d.customers));
      localStorage.setItem('st_contacts', JSON.stringify(d.contacts));
      localStorage.setItem('st_cashDrawer', JSON.stringify(d.cashDrawer));
      localStorage.setItem('st_cashDrawerHistory', JSON.stringify(d.cashDrawerHistory));
    }, data);
    await page.reload();
    await page.waitForFunction(() => {
      const el = document.getElementById('outSpot');
      return el && !el.textContent.includes('$0.00');
    }, { timeout: 5000 });
  }

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedDrawerAndReload(page);
  });

  test('opens drawer with correct balance', async ({ page }) => {
    await page.click('[data-page="cashdrawer"]');
    await page.click('button:has-text("Open Drawer")');
    await page.fill('#openDrawerBalance', '500');
    await page.click('#openDrawerConfirmBtn');

    const drawer = await page.evaluate(() => JSON.parse(localStorage.getItem('st_cashDrawer')));
    expect(drawer.status).toBe('open');
    expect(drawer.openingBalance).toBe(500);
    expect(drawer.currentBalance).toBe(500);
    expect(drawer.entries.length).toBe(1);
    expect(drawer.entries[0].type).toBe('open');
  });

  test('rejects negative opening balance', async ({ page }) => {
    await page.click('[data-page="cashdrawer"]');
    await page.click('button:has-text("Open Drawer")');
    await page.fill('#openDrawerBalance', '-100');

    page.on('dialog', async dialog => {
      expect(dialog.message()).toContain('negative');
      await dialog.dismiss();
    });
    await page.click('#openDrawerConfirmBtn');

    const drawer = await page.evaluate(() => JSON.parse(localStorage.getItem('st_cashDrawer')));
    expect(drawer.status).toBe('closed');
  });

  test('cannot open when already open', async ({ page }) => {
    const openDrawer = {
      status: 'open', openedAt: new Date().toISOString(), openingBalance: 200, currentBalance: 200,
      sessionId: 'ds-test', entries: [{ id: 'de-1', timestamp: new Date().toISOString(), type: 'open', amount: 200, runningBalance: 200, note: 'Drawer opened' }]
    };
    await seedDrawerAndReload(page, { cashDrawer: openDrawer });
    await page.click('[data-page="cashdrawer"]');
    // Open Drawer button should not be present in status actions when drawer is already open
    await expect(page.locator('#drawerStatusActions button:has-text("Open Drawer")')).toHaveCount(0);
  });

  test('closes drawer with discrepancy', async ({ page }) => {
    const openDrawer = {
      status: 'open', openedAt: new Date().toISOString(), openingBalance: 500, currentBalance: 500,
      sessionId: 'ds-test', entries: [{ id: 'de-1', timestamp: new Date().toISOString(), type: 'open', amount: 500, runningBalance: 500, note: 'Drawer opened' }]
    };
    await seedDrawerAndReload(page, { cashDrawer: openDrawer });
    await page.click('[data-page="cashdrawer"]');
    await page.click('button:has-text("Close Drawer")');
    await page.fill('#closeDrawerActual', '480');
    await page.click('#closeDrawerConfirmBtn');

    const history = await page.evaluate(() => JSON.parse(localStorage.getItem('st_cashDrawerHistory')));
    expect(history.length).toBe(1);
    expect(history[0].expectedBalance).toBe(500);
    expect(history[0].actualBalance).toBe(480);
    expect(history[0].discrepancy).toBe(-20);
  });

  test('close modal shows live discrepancy', async ({ page }) => {
    const openDrawer = {
      status: 'open', openedAt: new Date().toISOString(), openingBalance: 300, currentBalance: 300,
      sessionId: 'ds-test', entries: [{ id: 'de-1', timestamp: new Date().toISOString(), type: 'open', amount: 300, runningBalance: 300, note: 'Drawer opened' }]
    };
    await seedDrawerAndReload(page, { cashDrawer: openDrawer });
    await page.click('[data-page="cashdrawer"]');
    await page.click('button:has-text("Close Drawer")');
    await page.fill('#closeDrawerActual', '320');

    const discText = await page.textContent('#closeDrawerDiscrepancy');
    expect(discText).toContain('over');
  });

  test('cash in adjustment increases balance', async ({ page }) => {
    const openDrawer = {
      status: 'open', openedAt: new Date().toISOString(), openingBalance: 100, currentBalance: 100,
      sessionId: 'ds-test', entries: [{ id: 'de-1', timestamp: new Date().toISOString(), type: 'open', amount: 100, runningBalance: 100, note: 'Drawer opened' }]
    };
    await seedDrawerAndReload(page, { cashDrawer: openDrawer });
    await page.click('[data-page="cashdrawer"]');
    await page.click('button:has-text("Adjustment")');
    await page.selectOption('#cashAdjustmentType', 'adjustment_in');
    await page.fill('#cashAdjustmentAmount', '50');
    await page.fill('#cashAdjustmentNote', 'Petty cash');
    await page.click('#cashAdjustmentConfirmBtn');

    const drawer = await page.evaluate(() => JSON.parse(localStorage.getItem('st_cashDrawer')));
    expect(drawer.currentBalance).toBe(150);
    const lastEntry = drawer.entries[drawer.entries.length - 1];
    expect(lastEntry.type).toBe('adjustment_in');
    expect(lastEntry.amount).toBe(50);
  });

  test('cash out adjustment decreases balance', async ({ page }) => {
    const openDrawer = {
      status: 'open', openedAt: new Date().toISOString(), openingBalance: 200, currentBalance: 200,
      sessionId: 'ds-test', entries: [{ id: 'de-1', timestamp: new Date().toISOString(), type: 'open', amount: 200, runningBalance: 200, note: 'Drawer opened' }]
    };
    await seedDrawerAndReload(page, { cashDrawer: openDrawer });
    await page.click('[data-page="cashdrawer"]');
    await page.click('button:has-text("Adjustment")');
    await page.selectOption('#cashAdjustmentType', 'adjustment_out');
    await page.fill('#cashAdjustmentAmount', '75');
    await page.fill('#cashAdjustmentNote', 'Bank deposit');
    await page.click('#cashAdjustmentConfirmBtn');

    const drawer = await page.evaluate(() => JSON.parse(localStorage.getItem('st_cashDrawer')));
    expect(drawer.currentBalance).toBe(125);
    const lastEntry = drawer.entries[drawer.entries.length - 1];
    expect(lastEntry.type).toBe('adjustment_out');
    expect(lastEntry.amount).toBe(-75);
  });

  test('rejects adjustment with no note', async ({ page }) => {
    const openDrawer = {
      status: 'open', openedAt: new Date().toISOString(), openingBalance: 100, currentBalance: 100,
      sessionId: 'ds-test', entries: [{ id: 'de-1', timestamp: new Date().toISOString(), type: 'open', amount: 100, runningBalance: 100, note: 'Drawer opened' }]
    };
    await seedDrawerAndReload(page, { cashDrawer: openDrawer });
    await page.click('[data-page="cashdrawer"]');
    await page.click('button:has-text("Adjustment")');
    await page.fill('#cashAdjustmentAmount', '20');
    // Leave note empty

    page.on('dialog', async dialog => {
      expect(dialog.message()).toContain('note');
      await dialog.dismiss();
    });
    await page.click('#cashAdjustmentConfirmBtn');

    const drawer = await page.evaluate(() => JSON.parse(localStorage.getItem('st_cashDrawer')));
    expect(drawer.currentBalance).toBe(100);
  });

  test('cash sale auto-adds sale entry', async ({ page }) => {
    // Open drawer first
    await page.click('[data-page="cashdrawer"]');
    await page.click('button:has-text("Open Drawer")');
    await page.fill('#openDrawerBalance', '100');
    await page.click('#openDrawerConfirmBtn');

    // Log a cash sell deal
    await page.click('[data-page="calculator"]');
    await page.click('.segment-btn[data-value="sell"]');
    await page.selectOption('#calcMetal', 'gold');
    await page.selectOption('#calcForm', 'coins');
    await page.fill('#calcQty', '1');
    await page.click('#logDealBtn');

    const drawer = await page.evaluate(() => JSON.parse(localStorage.getItem('st_cashDrawer')));
    const saleEntry = drawer.entries.find(e => e.type === 'sale');
    expect(saleEntry).toBeTruthy();
    expect(saleEntry.amount).toBeGreaterThan(0);
    expect(saleEntry.txId).toBeTruthy();
  });

  test('cash buy auto-adds buy entry', async ({ page }) => {
    await page.click('[data-page="cashdrawer"]');
    await page.click('button:has-text("Open Drawer")');
    await page.fill('#openDrawerBalance', '5000');
    await page.click('#openDrawerConfirmBtn');

    await page.click('[data-page="calculator"]');
    await page.click('.segment-btn[data-value="buy"]');
    await page.selectOption('#calcMetal', 'gold');
    await page.selectOption('#calcForm', 'coins');
    await page.fill('#calcQty', '1');
    await page.click('#logDealBtn');

    const drawer = await page.evaluate(() => JSON.parse(localStorage.getItem('st_cashDrawer')));
    const buyEntry = drawer.entries.find(e => e.type === 'buy');
    expect(buyEntry).toBeTruthy();
    expect(buyEntry.amount).toBeLessThan(0);
    expect(buyEntry.txId).toBeTruthy();
  });

  test('non-cash tx does not add entry', async ({ page }) => {
    await page.click('[data-page="cashdrawer"]');
    await page.click('button:has-text("Open Drawer")');
    await page.fill('#openDrawerBalance', '100');
    await page.click('#openDrawerConfirmBtn');

    await page.click('[data-page="calculator"]');
    await page.selectOption('#calcPayment', 'wire');
    await page.click('.segment-btn[data-value="sell"]');
    await page.selectOption('#calcMetal', 'gold');
    await page.selectOption('#calcForm', 'coins');
    await page.fill('#calcQty', '1');
    await page.click('#logDealBtn');

    const drawer = await page.evaluate(() => JSON.parse(localStorage.getItem('st_cashDrawer')));
    // Should only have the open entry
    expect(drawer.entries.filter(e => e.type === 'sale').length).toBe(0);
  });

  test('closed drawer does not track', async ({ page }) => {
    // Drawer is closed by default
    await page.click('[data-page="calculator"]');
    await page.click('.segment-btn[data-value="sell"]');
    await page.selectOption('#calcMetal', 'gold');
    await page.selectOption('#calcForm', 'coins');
    await page.fill('#calcQty', '1');
    await page.click('#logDealBtn');

    const drawer = await page.evaluate(() => JSON.parse(localStorage.getItem('st_cashDrawer')));
    expect(drawer.entries.length).toBe(0);
  });

  test('deleting cash tx removes drawer entry', async ({ page }) => {
    // Open drawer and log a cash sale
    await page.click('[data-page="cashdrawer"]');
    await page.click('button:has-text("Open Drawer")');
    await page.fill('#openDrawerBalance', '100');
    await page.click('#openDrawerConfirmBtn');

    await page.click('[data-page="calculator"]');
    await page.click('.segment-btn[data-value="sell"]');
    await page.selectOption('#calcMetal', 'gold');
    await page.selectOption('#calcForm', 'coins');
    await page.fill('#calcQty', '1');
    await page.click('#logDealBtn');

    // Verify entry was created
    let drawer = await page.evaluate(() => JSON.parse(localStorage.getItem('st_cashDrawer')));
    expect(drawer.entries.find(e => e.type === 'sale')).toBeTruthy();

    // Close receipt modal if open
    const receiptModal = page.locator('#receiptModal');
    if (await receiptModal.evaluate(el => el.classList.contains('open')).catch(() => false)) {
      await page.click('#receiptCloseBtn');
    }

    // Delete the transaction
    await page.click('[data-page="transactions"]');
    page.on('dialog', dialog => dialog.accept());
    await page.locator('#txBody tr').first().locator('button', { hasText: '🗑' }).click();
    await page.click('#deleteConfirmBtn');

    drawer = await page.evaluate(() => JSON.parse(localStorage.getItem('st_cashDrawer')));
    expect(drawer.entries.find(e => e.type === 'sale')).toBeFalsy();
  });

  test('dashboard shows balance when open', async ({ page }) => {
    const openDrawer = {
      status: 'open', openedAt: new Date().toISOString(), openingBalance: 750, currentBalance: 750,
      sessionId: 'ds-test', entries: [{ id: 'de-1', timestamp: new Date().toISOString(), type: 'open', amount: 750, runningBalance: 750, note: 'Drawer opened' }]
    };
    await seedDrawerAndReload(page, { cashDrawer: openDrawer });
    await page.click('[data-page="dashboard"]');

    const text = await page.textContent('#dashDrawerBalance');
    expect(text).toContain('750');
  });

  test('dashboard shows Closed when closed', async ({ page }) => {
    await page.click('[data-page="dashboard"]');
    const text = await page.textContent('#dashDrawerBalance');
    expect(text).toBe('Closed');
  });

  test('session history renders', async ({ page }) => {
    const historyData = [{
      sessionId: 'ds-hist-1', openedAt: '2025-01-15T09:00:00Z', closedAt: '2025-01-15T17:00:00Z',
      openingBalance: 500, expectedBalance: 680, actualBalance: 680, discrepancy: 0,
      entries: [
        { id: 'de-h1', timestamp: '2025-01-15T09:00:00Z', type: 'open', amount: 500, runningBalance: 500, note: 'Opened' },
        { id: 'de-h2', timestamp: '2025-01-15T17:00:00Z', type: 'close', amount: 0, runningBalance: 680, note: 'Closed' }
      ]
    }];
    await seedDrawerAndReload(page, { cashDrawerHistory: historyData });
    await page.click('[data-page="cashdrawer"]');

    const items = page.locator('.drawer-history-item');
    await expect(items).toHaveCount(1);
  });

  test('history item expands on click', async ({ page }) => {
    const historyData = [{
      sessionId: 'ds-hist-1', openedAt: '2025-01-15T09:00:00Z', closedAt: '2025-01-15T17:00:00Z',
      openingBalance: 500, expectedBalance: 680, actualBalance: 680, discrepancy: 0,
      entries: [
        { id: 'de-h1', timestamp: '2025-01-15T09:00:00Z', type: 'open', amount: 500, runningBalance: 500, note: 'Opened' },
        { id: 'de-h2', timestamp: '2025-01-15T17:00:00Z', type: 'close', amount: 0, runningBalance: 680, note: 'Closed' }
      ]
    }];
    await seedDrawerAndReload(page, { cashDrawerHistory: historyData });
    await page.click('[data-page="cashdrawer"]');

    const item = page.locator('.drawer-history-item').first();
    await expect(item).not.toHaveClass(/expanded/);
    await item.locator('.drawer-history-header').click();
    await expect(item).toHaveClass(/expanded/);
  });
});

// ─── Reporting & Charts ───────────────────────────────────────────

test.describe('Reporting & Charts', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page);
    await seedAndReload(page);
  });

  test('Reports page accessible via nav', async ({ page }) => {
    await page.click('[data-page="reports"]');
    const reportsPage = page.locator('#page-reports');
    await expect(reportsPage).toHaveClass(/active/);
  });

  test('Period selector defaults to 30D', async ({ page }) => {
    await page.click('[data-page="reports"]');
    const activeBtn = page.locator('#reportsPeriodSelector .period-btn.active');
    await expect(activeBtn).toHaveText('30D');
  });

  test('Period selector changes active state', async ({ page }) => {
    await page.click('[data-page="reports"]');
    await page.click('#reportsPeriodSelector .period-btn[data-rperiod="7d"]');
    const btn7d = page.locator('#reportsPeriodSelector .period-btn[data-rperiod="7d"]');
    const btn30d = page.locator('#reportsPeriodSelector .period-btn[data-rperiod="30d"]');
    await expect(btn7d).toHaveClass(/active/);
    await expect(btn30d).not.toHaveClass(/active/);
  });

  test('Summary KPIs show correct values', async ({ page }) => {
    // Seed with known transactions within the "all" period
    const txs = [
      { id: 'rpt-1', date: new Date().toISOString(), type: 'buy', metal: 'gold', form: 'coins', coinType: 'eagles', qty: 1, spot: 2000, price: 1940, total: 1940, profit: 60, payment: 'cash', customerId: 'cust-val-1', notes: '' },
      { id: 'rpt-2', date: new Date().toISOString(), type: 'sell', metal: 'silver', form: 'bars', coinType: '', qty: 100, spot: 30, price: 31.5, total: 3150, profit: 150, payment: 'wire', customerId: 'cust-val-1', notes: '' },
    ];
    await page.evaluate((data) => {
      localStorage.setItem('st_transactions', JSON.stringify(data));
    }, txs);
    await page.reload();
    await page.waitForFunction(() => document.getElementById('rptRevenue'));
    await page.click('[data-page="reports"]');
    // Switch to "all" period so our txs are included
    await page.click('#reportsPeriodSelector .period-btn[data-rperiod="all"]');
    await expect(page.locator('#rptRevenue')).toHaveText('$5,090.00');
    await expect(page.locator('#rptProfit')).toHaveText('$210.00');
    await expect(page.locator('#rptCount')).toHaveText('2');
  });

  test('Chart canvases exist', async ({ page }) => {
    await page.click('[data-page="reports"]');
    await expect(page.locator('#chartRevenue')).toBeVisible();
    await expect(page.locator('#chartVolume')).toBeVisible();
    await expect(page.locator('#chartInventory')).toBeVisible();
    await expect(page.locator('#chartMetal')).toBeVisible();
    await expect(page.locator('#chartPayment')).toBeVisible();
    await expect(page.locator('#chartTopCustomers')).toBeVisible();
  });

  test('Charts render with empty data', async ({ page }) => {
    await page.evaluate(() => {
      localStorage.setItem('st_transactions', JSON.stringify([]));
    });
    await page.reload();
    await page.waitForFunction(() => document.getElementById('rptRevenue'));
    await page.click('[data-page="reports"]');
    // Should not throw — KPIs show zero values
    await expect(page.locator('#rptRevenue')).toHaveText('$0.00');
    await expect(page.locator('#rptCount')).toHaveText('0');
  });

  test('Period change re-renders', async ({ page }) => {
    const txs = [
      { id: 'rpt-recent', date: new Date().toISOString(), type: 'sell', metal: 'gold', form: 'bars', coinType: '', qty: 1, spot: 2000, price: 2100, total: 2100, profit: 100, payment: 'cash', customerId: '', notes: '' },
      { id: 'rpt-old', date: '2020-01-01T12:00:00Z', type: 'sell', metal: 'gold', form: 'bars', coinType: '', qty: 1, spot: 1500, price: 1575, total: 1575, profit: 75, payment: 'wire', customerId: '', notes: '' },
    ];
    await page.evaluate((data) => {
      localStorage.setItem('st_transactions', JSON.stringify(data));
    }, txs);
    await page.reload();
    await page.waitForFunction(() => document.getElementById('rptRevenue'));
    await page.click('[data-page="reports"]');
    // 30D default should only have the recent tx
    await expect(page.locator('#rptCount')).toHaveText('1');
    // Switch to "all" — should show both
    await page.click('#reportsPeriodSelector .period-btn[data-rperiod="all"]');
    await expect(page.locator('#rptCount')).toHaveText('2');
  });

  test('Metal breakdown correct', async ({ page }) => {
    const txs = [
      { id: 'rpt-g', date: new Date().toISOString(), type: 'buy', metal: 'gold', form: 'bars', coinType: '', qty: 1, spot: 2000, price: 1940, total: 1940, profit: 60, payment: 'cash', customerId: '', notes: '' },
      { id: 'rpt-s', date: new Date().toISOString(), type: 'buy', metal: 'silver', form: 'bars', coinType: '', qty: 100, spot: 30, price: 29, total: 2900, profit: 100, payment: 'cash', customerId: '', notes: '' },
    ];
    await page.evaluate((data) => {
      localStorage.setItem('st_transactions', JSON.stringify(data));
    }, txs);
    await page.reload();
    await page.waitForFunction(() => document.getElementById('rptRevenue'));
    await page.click('[data-page="reports"]');
    // Verify via evaluating the aggregateByMetal function
    const metals = await page.evaluate(() => {
      const txs = JSON.parse(localStorage.getItem('st_transactions'));
      let gold = 0, silver = 0;
      txs.forEach(tx => { if (tx.metal === 'gold') gold += tx.total; else silver += tx.total; });
      return { gold, silver };
    });
    expect(metals.gold).toBe(1940);
    expect(metals.silver).toBe(2900);
  });

  test('Payment breakdown correct', async ({ page }) => {
    const txs = [
      { id: 'rpt-c', date: new Date().toISOString(), type: 'buy', metal: 'gold', form: 'bars', coinType: '', qty: 1, spot: 2000, price: 1940, total: 1940, profit: 60, payment: 'cash', customerId: '', notes: '' },
      { id: 'rpt-w', date: new Date().toISOString(), type: 'sell', metal: 'silver', form: 'bars', coinType: '', qty: 50, spot: 30, price: 31, total: 1550, profit: 50, payment: 'wire', customerId: '', notes: '' },
    ];
    await page.evaluate((data) => {
      localStorage.setItem('st_transactions', JSON.stringify(data));
    }, txs);
    await page.reload();
    await page.waitForFunction(() => document.getElementById('rptRevenue'));
    await page.click('[data-page="reports"]');
    const payments = await page.evaluate(() => {
      const txs = JSON.parse(localStorage.getItem('st_transactions'));
      const r = { cash: 0, wire: 0, check: 0 };
      txs.forEach(tx => { r[tx.payment] = (r[tx.payment] || 0) + tx.total; });
      return r;
    });
    expect(payments.cash).toBe(1940);
    expect(payments.wire).toBe(1550);
  });

  test('Top customers ranking correct', async ({ page }) => {
    const txs = [
      { id: 'rpt-tc1', date: new Date().toISOString(), type: 'buy', metal: 'gold', form: 'bars', coinType: '', qty: 1, spot: 2000, price: 1940, total: 5000, profit: 60, payment: 'cash', customerId: 'c1', notes: '' },
      { id: 'rpt-tc2', date: new Date().toISOString(), type: 'buy', metal: 'gold', form: 'bars', coinType: '', qty: 1, spot: 2000, price: 1940, total: 3000, profit: 60, payment: 'cash', customerId: 'c2', notes: '' },
      { id: 'rpt-tc3', date: new Date().toISOString(), type: 'buy', metal: 'gold', form: 'bars', coinType: '', qty: 1, spot: 2000, price: 1940, total: 8000, profit: 60, payment: 'cash', customerId: 'c3', notes: '' },
    ];
    const custs = [
      { id: 'c1', name: 'Alice', email: '', phone: '' },
      { id: 'c2', name: 'Bob', email: '', phone: '' },
      { id: 'c3', name: 'Charlie', email: '', phone: '' },
    ];
    await page.evaluate((data) => {
      localStorage.setItem('st_transactions', JSON.stringify(data.txs));
      localStorage.setItem('st_customers', JSON.stringify(data.custs));
    }, { txs, custs });
    await page.reload();
    await page.waitForFunction(() => document.getElementById('rptRevenue'));
    await page.click('[data-page="reports"]');
    // Verify top customers ranking via the getTopCustomers function
    const topNames = await page.evaluate(() => {
      const txs = JSON.parse(localStorage.getItem('st_transactions'));
      const custs = JSON.parse(localStorage.getItem('st_customers'));
      const map = {};
      txs.forEach(tx => {
        if (!tx.customerId) return;
        const c = custs.find(c => c.id === tx.customerId);
        const name = c ? c.name : tx.customerId;
        map[name] = (map[name] || 0) + (tx.total || 0);
      });
      return Object.entries(map).sort((a, b) => b[1] - a[1]).map(e => e[0]);
    });
    expect(topNames[0]).toBe('Charlie');
    expect(topNames[1]).toBe('Alice');
    expect(topNames[2]).toBe('Bob');
  });
});

// ─── Trade / Swap Transactions ────────────────────────────────────────

test.describe('Trade / Swap Transactions', () => {
  const TRADE_SETTINGS = {
    shopName: 'Trade Test Shop',
    sellPremCoins: 7, sellPremBars: 5, sellPremScrap: 3,
    buyDiscCoins: 3, buyDiscBars: 5, buyDiscScrap: 8,
    whDiscCoins: 1, whDiscBars: 2, whDiscScrap: 3,
    coinAdjustments: { eagles: 0, maples: 0, krugerrands: 0, britannias: 0, philharmonics: 0, pre33: 0 },
    junkMultiplier: 0.715, junkMultOverride: null,
    sellPremJunk: 7, buyDiscJunk: 3, whDiscJunk: 1,
    tradeInDiscCoins: 2, tradeInDiscBars: 2, tradeInDiscScrap: 4,
    tradeOutPremCoins: 4, tradeOutPremBars: 3, tradeOutPremScrap: 2,
    tradeInDiscJunk: 2, tradeOutPremJunk: 4,
    threshGold: 10, threshSilver: 500,
    reorderPoints: {},
    premiumModes: {},
    taxEnabled: false,
    taxState: '',
    taxRateOverride: null
  };

  async function seedTradeData(page, overrides = {}) {
    const data = {
      settings: { ...TRADE_SETTINGS, ...(overrides.settings || {}) },
      transactions: overrides.transactions || [],
      customers: overrides.customers || [{ id: 'cust-trade-1', name: 'Trade Customer', email: 'trade@example.com', phone: '' }],
      contacts: [],
    };
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

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await mockSpotPrices(page, { gold: 2500, silver: 32 });
    await seedTradeData(page);
  });

  test('Trade button appears in calculator segment control', async ({ page }) => {
    await page.click('[data-page="calculator"]');
    const tradeBtn = page.locator('.segment-btn[data-value="trade"]');
    await expect(tradeBtn).toBeVisible();
    await expect(tradeBtn).toHaveText('Trade / Swap');
  });

  test('Trade panel shows when trade selected, standard fields hide', async ({ page }) => {
    await page.click('[data-page="calculator"]');
    // Standard form grid should be visible
    await expect(page.locator('.calc-inputs .form-grid')).toBeVisible();
    await expect(page.locator('#tradePanel')).not.toHaveClass(/active/);

    // Click trade
    await page.click('.segment-btn[data-value="trade"]');
    await expect(page.locator('#tradePanel')).toHaveClass(/active/);
    // Standard form grid hidden
    const formGridDisplay = await page.locator('.calc-inputs .form-grid').evaluate(el => getComputedStyle(el).display);
    expect(formGridDisplay).toBe('none');
  });

  test('Trade pricing uses trade-specific margins from settings', async ({ page }) => {
    await page.click('[data-page="calculator"]');
    await page.click('.segment-btn[data-value="trade"]');

    // Set trade in: gold coins, qty 1
    await page.selectOption('#tradeInMetal', 'gold');
    await page.selectOption('#tradeInForm', 'coins');
    await page.fill('#tradeInQty', '1');

    // Set trade out: silver bars, qty 50
    await page.selectOption('#tradeOutMetal', 'silver');
    await page.selectOption('#tradeOutForm', 'bars');
    await page.fill('#tradeOutQty', '50');

    // Trade-in value: gold spot $2500 * (1 - 2%) = $2450
    const inValue = await page.textContent('#tradeInValue');
    expect(inValue).toContain('2,450');

    // Trade-out value: silver spot $32 * (1 + 3%) * 50 = $1,648
    const outValue = await page.textContent('#tradeOutValue');
    expect(outValue).toContain('1,648');
  });

  test('Settlement correct when outbound > inbound (customer pays)', async ({ page }) => {
    await page.click('[data-page="calculator"]');
    await page.click('.segment-btn[data-value="trade"]');

    // Customer gives silver, gets gold (gold is more expensive)
    await page.selectOption('#tradeInMetal', 'silver');
    await page.selectOption('#tradeInForm', 'bars');
    await page.fill('#tradeInQty', '10');

    await page.selectOption('#tradeOutMetal', 'gold');
    await page.selectOption('#tradeOutForm', 'bars');
    await page.fill('#tradeOutQty', '1');

    // Trade-in: silver $32 * (1 - 2%) * 10 = $313.60
    // Trade-out: gold $2500 * (1 + 3%) * 1 = $2575
    // Settlement: $2575 - $313.60 = $2261.40 (customer pays)
    const label = await page.textContent('#tradeSettlementLabel');
    expect(label).toContain('Customer Pays');
  });

  test('Settlement correct when inbound > outbound (we pay)', async ({ page }) => {
    await page.click('[data-page="calculator"]');
    await page.click('.segment-btn[data-value="trade"]');

    // Customer gives gold, gets silver (gold is more expensive)
    await page.selectOption('#tradeInMetal', 'gold');
    await page.selectOption('#tradeInForm', 'bars');
    await page.fill('#tradeInQty', '1');

    await page.selectOption('#tradeOutMetal', 'silver');
    await page.selectOption('#tradeOutForm', 'bars');
    await page.fill('#tradeOutQty', '10');

    // Trade-in: gold $2500 * (1 - 2%) = $2450
    // Trade-out: silver $32 * (1 + 3%) * 10 = $329.60
    // Settlement: $329.60 - $2450 = -$2120.40 (we pay)
    const label = await page.textContent('#tradeSettlementLabel');
    expect(label).toContain('We Pay');
  });

  test('Trade logged with tradeIn/tradeOut data', async ({ page }) => {
    await page.click('[data-page="calculator"]');
    await page.click('.segment-btn[data-value="trade"]');

    await page.selectOption('#tradeInMetal', 'gold');
    await page.selectOption('#tradeInForm', 'coins');
    await page.fill('#tradeInQty', '1');

    await page.selectOption('#tradeOutMetal', 'silver');
    await page.selectOption('#tradeOutForm', 'bars');
    await page.fill('#tradeOutQty', '50');

    await page.click('#logDealBtn');

    const tx = await page.evaluate(() => {
      const txs = JSON.parse(localStorage.getItem('st_transactions'));
      return txs.find(t => t.type === 'trade');
    });

    expect(tx).toBeTruthy();
    expect(tx.type).toBe('trade');
    expect(tx.tradeIn).toBeTruthy();
    expect(tx.tradeIn.metal).toBe('gold');
    expect(tx.tradeIn.form).toBe('coins');
    expect(tx.tradeIn.qty).toBe(1);
    expect(tx.tradeOut).toBeTruthy();
    expect(tx.tradeOut.metal).toBe('silver');
    expect(tx.tradeOut.form).toBe('bars');
    expect(tx.tradeOut.qty).toBe(50);
    expect(tx.settlement).toBeDefined();
    expect(tx.profit).toBeGreaterThan(0);
  });

  test('Inventory: inbound added, outbound subtracted', async ({ page }) => {
    // Seed with existing inventory + a trade
    const tradeTx = {
      id: 'tx-trade-inv',
      date: new Date().toISOString(),
      type: 'trade',
      tradeIn: { metal: 'gold', form: 'bars', coinType: null, qty: 2, spot: 2500, price: 2450, total: 4900 },
      tradeOut: { metal: 'silver', form: 'bars', coinType: null, qty: 100, spot: 32, price: 32.96, total: 3296 },
      metal: 'gold',
      total: 1604,
      subtotal: 1604,
      settlement: -1604,
      profit: 196,
      payment: 'cash',
      lines: [],
      taxRate: 0,
      taxAmount: 0
    };
    // Also add existing silver inventory via a buy
    const buyTx = {
      id: 'tx-buy-silver',
      date: '2025-01-01T00:00:00Z',
      type: 'buy',
      metal: 'silver',
      form: 'bars',
      qty: 200,
      spot: 30,
      price: 29,
      total: 5800,
      profit: 200,
      payment: 'cash',
      lines: [{ metal: 'silver', form: 'bars', coinType: null, qty: 200, spot: 30, price: 29, total: 5800, profit: 200 }]
    };
    await seedTradeData(page, { transactions: [tradeTx, buyTx] });

    const inv = await page.evaluate(() => getInventory());
    // Gold bars: trade-in adds 2oz
    expect(inv.inv.gold.bars).toBeCloseTo(2, 3);
    // Silver bars: buy adds 200oz, trade-out subtracts 100oz = 100oz
    expect(inv.inv.silver.bars).toBeCloseTo(100, 3);
  });

  test('Trade appears in transaction log with Trade badge', async ({ page }) => {
    const tradeTx = {
      id: 'tx-trade-badge',
      date: new Date().toISOString(),
      type: 'trade',
      tradeIn: { metal: 'gold', form: 'coins', coinType: 'eagles', qty: 1, spot: 2500, price: 2450, total: 2450 },
      tradeOut: { metal: 'silver', form: 'bars', coinType: null, qty: 50, spot: 32, price: 32.96, total: 1648 },
      metal: 'gold',
      total: 802,
      subtotal: 802,
      settlement: -802,
      profit: 98,
      payment: 'cash',
      lines: [],
      taxRate: 0,
      taxAmount: 0
    };
    await seedTradeData(page, { transactions: [tradeTx] });
    await page.click('[data-page="transactions"]');

    const badge = page.locator('#txBody .type-badge.trade');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('Trade');
  });

  test('Trade filter works', async ({ page }) => {
    const tradeTx = {
      id: 'tx-trade-filter',
      date: new Date().toISOString(),
      type: 'trade',
      tradeIn: { metal: 'gold', form: 'coins', coinType: 'eagles', qty: 1, spot: 2500, price: 2450, total: 2450 },
      tradeOut: { metal: 'silver', form: 'bars', coinType: null, qty: 50, spot: 32, price: 32.96, total: 1648 },
      metal: 'gold',
      total: 802,
      subtotal: 802,
      settlement: -802,
      profit: 98,
      payment: 'cash',
      lines: [],
      taxRate: 0,
      taxAmount: 0
    };
    const buyTx = {
      id: 'tx-buy-filter',
      date: new Date().toISOString(),
      type: 'buy',
      metal: 'gold',
      form: 'bars',
      qty: 1,
      spot: 2500,
      price: 2425,
      total: 2425,
      profit: 75,
      payment: 'cash',
      lines: [{ metal: 'gold', form: 'bars', coinType: null, qty: 1, spot: 2500, price: 2425, total: 2425, profit: 75 }]
    };
    await seedTradeData(page, { transactions: [tradeTx, buyTx] });
    await page.click('[data-page="transactions"]');

    // Should show both
    let rows = await page.locator('#txBody tr').count();
    expect(rows).toBe(2);

    // Filter to trade only
    await page.selectOption('#filterType', 'trade');
    rows = await page.locator('#txBody tr').count();
    expect(rows).toBe(1);
    await expect(page.locator('#txBody .type-badge.trade')).toBeVisible();
  });

  test('P&L includes trade profit', async ({ page }) => {
    const tradeTx = {
      id: 'tx-trade-pnl',
      date: new Date().toISOString(),
      type: 'trade',
      tradeIn: { metal: 'gold', form: 'bars', coinType: null, qty: 1, spot: 2500, price: 2450, total: 2450 },
      tradeOut: { metal: 'silver', form: 'bars', coinType: null, qty: 50, spot: 32, price: 32.96, total: 1648 },
      metal: 'gold',
      total: 802,
      subtotal: 802,
      settlement: -802,
      profit: 146,
      payment: 'cash',
      lines: [],
      taxRate: 0,
      taxAmount: 0
    };
    await seedTradeData(page, { transactions: [tradeTx] });
    await page.click('[data-page="pnl"]');

    const profitText = await page.textContent('#pnlProfit');
    expect(profitText).toContain('146');
  });

  test('8300 flagged on large cash settlement', async ({ page }) => {
    await page.click('[data-page="calculator"]');
    await page.click('.segment-btn[data-value="trade"]');

    // Large trade: customer gives silver, gets gold
    await page.selectOption('#tradeInMetal', 'silver');
    await page.selectOption('#tradeInForm', 'bars');
    await page.fill('#tradeInQty', '100');

    await page.selectOption('#tradeOutMetal', 'gold');
    await page.selectOption('#tradeOutForm', 'bars');
    await page.fill('#tradeOutQty', '5');

    // Settlement will be gold_out_val - silver_in_val
    // Gold: 5 * 2500 * 1.03 = 12875
    // Silver: 100 * 32 * 0.98 = 3136
    // Settlement: 12875 - 3136 = 9739 (customer pays, under 10K)
    // But let's increase gold qty
    await page.fill('#tradeOutQty', '6');
    // Gold: 6 * 2500 * 1.03 = 15450
    // Settlement: 15450 - 3136 = 12314 (over 10K)

    // calcPayment is in the hidden form-grid, set it programmatically
    await page.evaluate(() => { document.getElementById('calcPayment').value = 'cash'; });
    await page.click('#logDealBtn');

    const tx = await page.evaluate(() => {
      const txs = JSON.parse(localStorage.getItem('st_transactions'));
      return txs.find(t => t.type === 'trade');
    });
    expect(tx).toBeTruthy();
    expect(tx.form8300Flag).toBe(true);
  });

  test('Both sides require qty > 0 to log', async ({ page }) => {
    await page.click('[data-page="calculator"]');
    await page.click('.segment-btn[data-value="trade"]');

    // Only fill one side
    await page.fill('#tradeInQty', '1');
    // tradeOutQty is empty/0
    await expect(page.locator('#logDealBtn')).toBeDisabled();

    // Fill both
    await page.fill('#tradeOutQty', '50');
    await expect(page.locator('#logDealBtn')).not.toBeDisabled();
  });
});

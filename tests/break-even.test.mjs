import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { analyzeBreakEven, analyzeMultiProduct, BreakEvenError } from '../dist/esm/index.js';

const single = (extra = {}) => ({
  fixedCostsCents: 1_000_000n,
  unitPriceCents: 2_500n,
  unitVariableCostCents: 1_000n,
  ...extra,
});

test('break-even units match a brute-force search', () => {
  for (const [fixed, price, variable] of [
    [1000, 30, 10],
    [1001, 30, 10],
    [0, 5, 1],
    [7, 3, 2],
    [999_999, 17, 4],
    [1, 100, 1],
  ]) {
    const result = analyzeBreakEven({
      fixedCostsCents: fixed,
      unitPriceCents: price,
      unitVariableCostCents: variable,
    });
    let u = 0;
    while (u * (price - variable) < fixed) u += 1;
    assert.equal(result.breakEvenUnits, BigInt(u), `${fixed} ${price} ${variable}`);
    if (u > 0) assert.ok((u - 1) * (price - variable) < fixed);
    assert.equal(result.breakEvenRevenueCents, BigInt(u * price));
  }
});

test('reports contribution margin, target units, and profit exactly', () => {
  const r = analyzeBreakEven(single({ targetProfitCents: 500_000n, expectedUnits: 1000n }));
  assert.equal(r.contributionPerUnitCents, 1500n);
  assert.equal(r.contributionMarginBps, 6000n);
  assert.equal(r.breakEvenUnits, 667n);
  assert.equal(r.targetUnits, 1000n);
  assert.equal(r.profitAtExpectedCents, 500_000n);
  assert.equal(r.marginOfSafetyUnits, 333n);
  assert.equal(r.marginOfSafetyBps, 3330n);
  assert.deepEqual(r.diagnostics, []);
});

test('diagnostics: no contribution, capacity, below break-even, zero fixed cost', () => {
  const none = analyzeBreakEven(single({ unitVariableCostCents: 2_500n }));
  assert.equal(none.breakEvenUnits, null);
  assert.deepEqual(none.diagnostics, ['no-contribution']);
  assert.equal(analyzeBreakEven(single({ unitVariableCostCents: 3_000n })).targetUnits, null);
  const capped = analyzeBreakEven(single({ capacityUnits: 600n }));
  assert.equal(capped.withinCapacity, false);
  assert.deepEqual(capped.diagnostics, ['exceeds-capacity']);
  assert.equal(analyzeBreakEven(single({ capacityUnits: 667n })).withinCapacity, true);
  const below = analyzeBreakEven(single({ expectedUnits: 500n }));
  assert.deepEqual(below.diagnostics, ['below-break-even']);
  assert.equal(below.marginOfSafetyBps, -3340n); // floor of -33.4%
  assert.equal(below.profitAtExpectedCents, -250_000n);
  const free = analyzeBreakEven(single({ fixedCostsCents: 0n }));
  assert.equal(free.breakEvenUnits, 0n);
  assert.deepEqual(free.diagnostics, ['zero-fixed-costs']);
  assert.equal(
    analyzeBreakEven({ fixedCostsCents: 1n, unitPriceCents: 0n, unitVariableCostCents: 0n })
      .contributionMarginBps,
    null,
  );
});

test('multi-product mix finds the exact whole-bundle break-even', () => {
  const input = {
    fixedCostsCents: 100_000n,
    products: [
      { name: 'basic', priceCents: 1000n, variableCostCents: 600n, mix: 3n },
      { name: 'pro', priceCents: 5000n, variableCostCents: 3000n, mix: 1n },
    ],
  };
  const r = analyzeMultiProduct(input);
  assert.equal(r.bundleContributionCents, 3200n);
  assert.equal(r.bundleRevenueCents, 8000n);
  assert.equal(r.bundles, 32n); // 31.25 bundles rounds up
  assert.deepEqual(
    r.products.map((p) => p.units),
    [96n, 32n],
  );
  assert.equal(r.totalRevenueCents, 256_000n);
  assert.ok(r.products.reduce((t, p) => t + p.contributionCents, 0n) >= 100_000n);
  assert.ok(31n * 3200n < 100_000n);
  const target = analyzeMultiProduct({ ...input, targetProfitCents: 28_000n });
  assert.equal(target.bundles, 40n);
});

test('multi-product capacity limits and non-positive bundle contribution', () => {
  const products = [
    { name: 'a', priceCents: 1000n, variableCostCents: 500n, mix: 2n, capacityUnits: 100n },
    { name: 'b', priceCents: 2000n, variableCostCents: 500n, mix: 1n, capacityUnits: 60n },
    { name: 'c', priceCents: 100n, variableCostCents: 50n, mix: 1n },
  ];
  const ok = analyzeMultiProduct({ fixedCostsCents: 100_000n, products });
  assert.equal(ok.bundles, 40n);
  assert.ok(!ok.diagnostics.includes('exceeds-capacity'));
  const r = analyzeMultiProduct({ fixedCostsCents: 200_000n, products });
  assert.equal(r.maxBundlesByCapacity, 50n);
  assert.deepEqual(r.limitingProducts, ['a']);
  assert.ok(r.diagnostics.includes('exceeds-capacity'));
  const loss = analyzeMultiProduct({
    fixedCostsCents: 10n,
    products: [
      { name: 'x', priceCents: 10n, variableCostCents: 20n, mix: 1n },
      { name: 'y', priceCents: 30n, variableCostCents: 10n, mix: 1n },
    ],
  });
  assert.equal(loss.bundleContributionCents, 10n);
  assert.equal(loss.bundles, 1n);
  const bad = analyzeMultiProduct({
    fixedCostsCents: 10n,
    products: [{ name: 'x', priceCents: 1n, variableCostCents: 2n, mix: 1n }],
  });
  assert.equal(bad.bundles, null);
  assert.equal(bad.products, null);
  assert.deepEqual(bad.diagnostics, ['no-contribution']);
});

test('malformed inputs and overflow-scale values', () => {
  for (const bad of [
    { fixedCostsCents: -1n },
    { fixedCostsCents: 1.5 },
    { unitPriceCents: '5' },
    { unitVariableCostCents: -1 },
    { capacityUnits: -1n },
    { targetProfitCents: -1n },
    { expectedUnits: NaN },
    { unitPriceCents: Number.MAX_SAFE_INTEGER + 2 },
  ]) {
    assert.throws(() => analyzeBreakEven(single(bad)), BreakEvenError);
  }
  const p = { name: 'a', priceCents: 2n, variableCostCents: 1n, mix: 1n };
  for (const products of [
    [],
    'x',
    [{ ...p, mix: 0n }],
    [{ ...p, name: '' }],
    [p, p],
    [{ ...p, mix: 1.5 }],
    [{ ...p, capacityUnits: -1n }],
  ]) {
    assert.throws(() => analyzeMultiProduct({ fixedCostsCents: 1n, products }), BreakEvenError);
  }
  const huge = analyzeBreakEven({
    fixedCostsCents: 10n ** 40n + 1n,
    unitPriceCents: 3n,
    unitVariableCostCents: 1n,
  });
  assert.equal(huge.breakEvenUnits, (10n ** 40n + 2n) / 2n);
  assert.equal(
    createRequire(import.meta.url)('@lp-labs/break-even-analysis').analyzeBreakEven(single())
      .breakEvenUnits,
    667n,
  );
});

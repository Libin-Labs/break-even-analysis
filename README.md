# @lp-labs/break-even-analysis

Exact integer break-even analysis for one product or a weighted sales mix. Money is `bigint` cents,
units are whole numbers, and every result is rounded in a stated direction. Problems such as no
contribution margin or insufficient capacity are reported as diagnostics instead of `Infinity` or
`NaN`.

## Install

```bash
npm install @lp-labs/break-even-analysis
```

ES2022 ESM and CommonJS builds ship with TypeScript declarations. There are no runtime dependencies.

## Quickstart

```js
import { analyzeBreakEven, analyzeMultiProduct } from '@lp-labs/break-even-analysis';

const single = analyzeBreakEven({
  fixedCostsCents: 1_000_000n,
  unitPriceCents: 2_500n,
  unitVariableCostCents: 1_000n,
  expectedUnits: 1000n,
});
if (single.breakEvenUnits !== 667n) throw new Error('unexpected break-even');

const mix = analyzeMultiProduct({
  fixedCostsCents: 100_000n,
  products: [
    { name: 'basic', priceCents: 1000n, variableCostCents: 600n, mix: 3n },
    { name: 'pro', priceCents: 5000n, variableCostCents: 3000n, mix: 1n },
  ],
});
console.log(single.marginOfSafetyBps, mix.bundles, mix.products);
```

## API

```ts
type BreakEvenDiagnostic =
  'no-contribution' | 'exceeds-capacity' | 'below-break-even' | 'zero-fixed-costs';
interface BreakEvenInput {
  fixedCostsCents: bigint | number;
  unitPriceCents: bigint | number;
  unitVariableCostCents: bigint | number;
  capacityUnits?: bigint | number;
  targetProfitCents?: bigint | number;
  expectedUnits?: bigint | number;
}
interface BreakEvenResult {
  contributionPerUnitCents: bigint;
  contributionMarginBps: bigint | null;
  breakEvenUnits: bigint | null;
  breakEvenRevenueCents: bigint | null;
  targetUnits: bigint | null;
  withinCapacity: boolean | null;
  profitAtExpectedCents: bigint | null;
  marginOfSafetyUnits: bigint | null;
  marginOfSafetyBps: bigint | null;
  diagnostics: readonly BreakEvenDiagnostic[];
}
interface MixProduct {
  name: string;
  priceCents: bigint | number;
  variableCostCents: bigint | number;
  mix: bigint | number;
  capacityUnits?: bigint | number;
}
interface MultiProductInput {
  fixedCostsCents: bigint | number;
  products: readonly MixProduct[];
  targetProfitCents?: bigint | number;
}
interface MixProductResult {
  name: string;
  units: bigint;
  revenueCents: bigint;
  contributionCents: bigint;
}
interface MultiProductResult {
  bundleContributionCents: bigint;
  bundleRevenueCents: bigint;
  bundles: bigint | null;
  totalRevenueCents: bigint | null;
  products: readonly MixProductResult[] | null;
  maxBundlesByCapacity: bigint | null;
  limitingProducts: readonly string[];
  diagnostics: readonly BreakEvenDiagnostic[];
}
type BreakEvenErrorCode = 'invalid-input';
class BreakEvenError extends Error {
  readonly code: 'invalid-input';
}
const MAX_PRODUCTS: 1000;
function analyzeBreakEven(input: BreakEvenInput): BreakEvenResult;
function analyzeMultiProduct(input: MultiProductInput): MultiProductResult;
```

- Break-even units are `ceil(fixed / (price - variable))`: the smallest whole count that covers
  fixed costs. `targetUnits` uses `fixed + targetProfit`. Both are `null` when contribution per unit
  is zero or negative (`no-contribution`).
- `contributionMarginBps` and `marginOfSafetyBps` are floored basis points (10000 = 100%).
- Capacity is checked against `targetUnits` (which equals break-even when no target is set).
- Multi-product analysis treats `mix` as integer units per bundle. The bundle contribution is the
  sum of `mix * (price - variable)`, bundles are `ceil((fixed + target) / bundleContribution)`, and
  each product's units are `bundles * mix`, so the sales mix is preserved exactly. Individual
  products with negative contribution are allowed if the bundle total is positive.
- Capacity per product limits bundles to `floor(capacity / mix)`; the smallest limit is reported with
  the product names that cause it.

## Customization

All policy is in the inputs: price, variable cost, mix weights, capacity, and target profit. Variable
costs are taken to be constant per unit; step costs are not modelled.

## Errors

Negative or non-integer money or units, duplicate/empty product names, empty or oversized product
lists, and zero mix throw `BreakEvenError`.

## Performance

Constant time for one product; linear in the product count (at most 1000).

## Honest scope

Textbook cost-volume-profit arithmetic with linear costs. No taxes, discounts, time value, uncertainty,
or forecasting; results are only as good as your inputs and are not business advice.

## Support

If this library is useful to you, consider supporting its maintenance with a [donation via PayPal](https://www.paypal.me/LibinPrasanth).

## Author

Created by [Libin Prasanth](https://www.linkedin.com/in/libinprasanth/). Connect on LinkedIn for updates and discussion.

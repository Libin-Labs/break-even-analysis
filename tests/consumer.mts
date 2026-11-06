import {
  analyzeBreakEven,
  analyzeMultiProduct,
  type BreakEvenResult,
  type MultiProductResult,
} from '@lp-labs/break-even-analysis';

const single: BreakEvenResult = analyzeBreakEven({
  fixedCostsCents: 1000n,
  unitPriceCents: 300n,
  unitVariableCostCents: 100n,
});
const multi: MultiProductResult = analyzeMultiProduct({
  fixedCostsCents: 1000n,
  products: [{ name: 'a', priceCents: 300n, variableCostCents: 100n, mix: 1n }],
});
const units: bigint | null = single.breakEvenUnits;
void [units, multi];

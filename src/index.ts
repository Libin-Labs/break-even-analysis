export type BreakEvenDiagnostic =
  'no-contribution' | 'exceeds-capacity' | 'below-break-even' | 'zero-fixed-costs';

export interface BreakEvenInput {
  readonly fixedCostsCents: bigint | number;
  readonly unitPriceCents: bigint | number;
  readonly unitVariableCostCents: bigint | number;
  /** Maximum units sellable in the period. */
  readonly capacityUnits?: bigint | number;
  /** Extra profit to cover beyond break-even; defaults to 0. */
  readonly targetProfitCents?: bigint | number;
  /** Planned sales, for margin of safety and profit. */
  readonly expectedUnits?: bigint | number;
}

export interface BreakEvenResult {
  readonly contributionPerUnitCents: bigint;
  /** Contribution margin ratio in basis points, rounded down; null when price is 0. */
  readonly contributionMarginBps: bigint | null;
  /** Smallest whole unit count whose contribution covers fixed costs; null without contribution. */
  readonly breakEvenUnits: bigint | null;
  readonly breakEvenRevenueCents: bigint | null;
  /** Smallest whole unit count reaching `targetProfitCents`. */
  readonly targetUnits: bigint | null;
  readonly withinCapacity: boolean | null;
  readonly profitAtExpectedCents: bigint | null;
  readonly marginOfSafetyUnits: bigint | null;
  /** (expected - break-even) / expected in basis points, rounded down; may be negative. */
  readonly marginOfSafetyBps: bigint | null;
  readonly diagnostics: readonly BreakEvenDiagnostic[];
}

export interface MixProduct {
  readonly name: string;
  readonly priceCents: bigint | number;
  readonly variableCostCents: bigint | number;
  /** Positive integer share of the sales mix, e.g. 3 means three units per bundle. */
  readonly mix: bigint | number;
  readonly capacityUnits?: bigint | number;
}

export interface MultiProductInput {
  readonly fixedCostsCents: bigint | number;
  readonly products: readonly MixProduct[];
  readonly targetProfitCents?: bigint | number;
}

export interface MixProductResult {
  readonly name: string;
  readonly units: bigint;
  readonly revenueCents: bigint;
  readonly contributionCents: bigint;
}

export interface MultiProductResult {
  readonly bundleContributionCents: bigint;
  readonly bundleRevenueCents: bigint;
  /** Whole mix bundles needed; null without positive bundle contribution. */
  readonly bundles: bigint | null;
  readonly totalRevenueCents: bigint | null;
  readonly products: readonly MixProductResult[] | null;
  /** Most bundles capacity allows; null when no product has a capacity. */
  readonly maxBundlesByCapacity: bigint | null;
  readonly limitingProducts: readonly string[];
  readonly diagnostics: readonly BreakEvenDiagnostic[];
}

export type BreakEvenErrorCode = 'invalid-input';

export class BreakEvenError extends Error {
  readonly code: BreakEvenErrorCode = 'invalid-input';
  constructor(message: string) {
    super(message);
    this.name = 'BreakEvenError';
  }
}

export const MAX_PRODUCTS = 1000;

function big(value: unknown, name: string, minimum = 0n): bigint {
  let result: bigint;
  if (typeof value === 'bigint') result = value;
  else if (typeof value === 'number' && Number.isSafeInteger(value)) result = BigInt(value);
  else throw new BreakEvenError(`${name} must be a bigint or safe integer.`);
  if (result < minimum) throw new BreakEvenError(`${name} must be at least ${minimum}.`);
  return result;
}

const optional = (value: unknown, name: string): bigint | undefined =>
  value === undefined ? undefined : big(value, name);

function ceilDiv(n: bigint, d: bigint): bigint {
  return n <= 0n ? 0n : (n + d - 1n) / d;
}

function floorDiv(n: bigint, d: bigint): bigint {
  const q = n / d;
  return n % d !== 0n && n < 0n !== d < 0n ? q - 1n : q;
}

export function analyzeBreakEven(input: BreakEvenInput): BreakEvenResult {
  const fixed = big(input.fixedCostsCents, 'fixedCostsCents');
  const price = big(input.unitPriceCents, 'unitPriceCents');
  const variable = big(input.unitVariableCostCents, 'unitVariableCostCents');
  const target = optional(input.targetProfitCents, 'targetProfitCents') ?? 0n;
  const capacity = optional(input.capacityUnits, 'capacityUnits');
  const expected = optional(input.expectedUnits, 'expectedUnits');
  const contribution = price - variable;
  const diagnostics: BreakEvenDiagnostic[] = [];
  if (fixed === 0n) diagnostics.push('zero-fixed-costs');
  const marginBps = price === 0n ? null : floorDiv(contribution * 10000n, price);
  const profit = expected === undefined ? null : expected * contribution - fixed;
  let breakEven: bigint | null = null;
  let targetUnits: bigint | null = null;
  if (contribution <= 0n) {
    diagnostics.push('no-contribution');
  } else {
    breakEven = ceilDiv(fixed, contribution);
    targetUnits = ceilDiv(fixed + target, contribution);
  }
  let within: boolean | null = null;
  if (capacity !== undefined && targetUnits !== null) {
    within = targetUnits <= capacity;
    if (!within) diagnostics.push('exceeds-capacity');
  }
  let safetyUnits: bigint | null = null;
  let safetyBps: bigint | null = null;
  if (expected !== undefined && breakEven !== null) {
    safetyUnits = expected - breakEven;
    if (safetyUnits < 0n) diagnostics.push('below-break-even');
    if (expected > 0n) safetyBps = floorDiv(safetyUnits * 10000n, expected);
  }
  return Object.freeze({
    contributionPerUnitCents: contribution,
    contributionMarginBps: marginBps,
    breakEvenUnits: breakEven,
    breakEvenRevenueCents: breakEven === null ? null : breakEven * price,
    targetUnits,
    withinCapacity: within,
    profitAtExpectedCents: profit,
    marginOfSafetyUnits: safetyUnits,
    marginOfSafetyBps: safetyBps,
    diagnostics: Object.freeze(diagnostics),
  });
}

export function analyzeMultiProduct(input: MultiProductInput): MultiProductResult {
  const fixed = big(input.fixedCostsCents, 'fixedCostsCents');
  const target = optional(input.targetProfitCents, 'targetProfitCents') ?? 0n;
  const list = input.products;
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_PRODUCTS) {
    throw new BreakEvenError(`products must hold 1 to ${MAX_PRODUCTS} entries.`);
  }
  const names = new Set<string>();
  let bundleContribution = 0n;
  let bundleRevenue = 0n;
  const parsed = list.map((product) => {
    if (typeof product?.name !== 'string' || product.name === '' || names.has(product.name)) {
      throw new BreakEvenError('Product names must be unique non-empty strings.');
    }
    names.add(product.name);
    const price = big(product.priceCents, `${product.name} priceCents`);
    const variable = big(product.variableCostCents, `${product.name} variableCostCents`);
    const mix = big(product.mix, `${product.name} mix`, 1n);
    const capacity = optional(product.capacityUnits, `${product.name} capacityUnits`);
    bundleContribution += mix * (price - variable);
    bundleRevenue += mix * price;
    return { name: product.name, price, variable, mix, capacity };
  });
  const diagnostics: BreakEvenDiagnostic[] = [];
  if (fixed === 0n) diagnostics.push('zero-fixed-costs');
  let maxBundles: bigint | null = null;
  let limiting: string[] = [];
  for (const product of parsed) {
    if (product.capacity === undefined) continue;
    const limit = product.capacity / product.mix;
    if (maxBundles === null || limit < maxBundles) {
      maxBundles = limit;
      limiting = [product.name];
    } else if (limit === maxBundles) limiting.push(product.name);
  }
  const base = { bundleContributionCents: bundleContribution, bundleRevenueCents: bundleRevenue };
  if (bundleContribution <= 0n) {
    diagnostics.push('no-contribution');
    return Object.freeze({
      ...base,
      bundles: null,
      totalRevenueCents: null,
      products: null,
      maxBundlesByCapacity: maxBundles,
      limitingProducts: Object.freeze(limiting),
      diagnostics: Object.freeze(diagnostics),
    });
  }
  const bundles = ceilDiv(fixed + target, bundleContribution);
  if (maxBundles !== null && bundles > maxBundles) diagnostics.push('exceeds-capacity');
  return Object.freeze({
    ...base,
    bundles,
    totalRevenueCents: bundles * bundleRevenue,
    products: Object.freeze(
      parsed.map((product) =>
        Object.freeze({
          name: product.name,
          units: bundles * product.mix,
          revenueCents: bundles * product.mix * product.price,
          contributionCents: bundles * product.mix * (product.price - product.variable),
        }),
      ),
    ),
    maxBundlesByCapacity: maxBundles,
    limitingProducts: Object.freeze(limiting),
    diagnostics: Object.freeze(diagnostics),
  });
}

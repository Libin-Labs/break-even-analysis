import { analyzeBreakEven, BreakEvenError } from '@lp-labs/break-even-analysis';

const diagnostics: readonly string[] = analyzeBreakEven({
  fixedCostsCents: 0,
  unitPriceCents: 1,
  unitVariableCostCents: 2,
}).diagnostics;
const code: 'invalid-input' = new BreakEvenError('x').code;
void [diagnostics, code];

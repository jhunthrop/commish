import type { MethodDescriptor } from "@/payments-provider/contract";
import { formatUsd } from "@/money/config";
import { US_STATE_CODES } from "@/money/states";

/**
 * One `Select` options list, shared by `DepositForm`, `WithdrawalForm` and `KycPanel` — every
 * money door self-attests the same state list (`stateOfEntry`, Task 5 Step 2's producer), so the
 * dropdown a member sees is one definition, not three that could silently drift apart.
 */
export const STATE_OF_ENTRY_OPTIONS = US_STATE_CODES.map((code) => ({ value: code, label: code }));

/**
 * The fee-and-ETA sentence `DepositForm` and `WithdrawalForm` both show BEFORE commit (Task 12
 * brief) — one function, shared, so a fee shown before a submit and the amount the server later
 * charges can never read as two different claims copied into two files. `etaDescription` is
 * shown verbatim (`MethodDescriptor`'s own docblock: "the UI shows it verbatim"); every dollar
 * figure passes through `formatUsd`, never a raw cents number.
 */
export function describeMethodFee(descriptor: MethodDescriptor): string {
  const { feeCents, feePercentBasisPoints, etaDescription } = descriptor;
  if (feeCents === 0 && feePercentBasisPoints === 0) return `No fee. ${etaDescription}.`;

  const parts: string[] = [];
  if (feeCents > 0) parts.push(formatUsd(feeCents));
  if (feePercentBasisPoints > 0) parts.push(`${feePercentBasisPoints / 100}%`);
  return `${parts.join(" plus ")} fee. ${etaDescription}.`;
}

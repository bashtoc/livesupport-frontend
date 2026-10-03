const digitRun = /(?<!\d)(?:\d[ -]?){10,19}(?!\d)/g;

export type MaskingResult = { text: string; masked: boolean; count: number };

export function maskFinancialIdentifiers(value: string): MaskingResult {
  let count = 0;
  const text = value.replace(digitRun, (candidate) => {
    const digits = candidate.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 19) return candidate;
    count += 1;
    const visible = digits.slice(-4);
    return `${"•".repeat(Math.min(digits.length - 4, 12))}${visible}`;
  });
  return { text, masked: count > 0, count };
}

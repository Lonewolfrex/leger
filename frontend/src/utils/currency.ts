export const INR = "₹";

export function formatINR(value: number): string {
  if (!Number.isFinite(value)) return `${INR}0`;
  const rounded = Math.round(value * 100) / 100;
  const [intPart, decPart] = rounded.toFixed(2).split(".");
  // Indian grouping: last 3 digits, then groups of 2
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3);
  const withCommas = rest ? rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3 : last3;
  return `${INR}${withCommas}${decPart === "00" ? "" : "." + decPart}`;
}

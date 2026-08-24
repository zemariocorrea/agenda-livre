export type ServicePaymentType = "none" | "full" | "deposit";
export type ManualPaymentMethod = "pix" | "contact" | "on_site";

export const servicePaymentTypes = new Set<ServicePaymentType>(["none", "full", "deposit"]);
export const manualPaymentMethods = new Set<ManualPaymentMethod>(["pix", "contact", "on_site"]);

export function servicePaymentType(value: unknown, fallback: ServicePaymentType = "none"): ServicePaymentType {
  return typeof value === "string" && servicePaymentTypes.has(value as ServicePaymentType)
    ? value as ServicePaymentType
    : fallback;
}

export function advancePaymentAmountCents(type: ServicePaymentType, priceCents: number, depositAmountCents: number | null | undefined) {
  if (type === "full") return Math.max(0, priceCents);
  if (type === "deposit") return Math.max(0, Number(depositAmountCents ?? 0));
  return 0;
}

export function validateServicePayment(type: ServicePaymentType, priceCents: number, depositAmountCents: number | null) {
  if (type !== "deposit") return null;
  if (!Number.isInteger(depositAmountCents) || (depositAmountCents ?? 0) <= 0) return "Informe um valor de sinal maior que zero.";
  if ((depositAmountCents ?? 0) > priceCents) return "O sinal não pode ser maior que o preço da atividade.";
  return null;
}

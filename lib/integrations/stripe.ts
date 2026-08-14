type CheckoutInput = {
  appointmentId: string;
  customerEmail: string;
  serviceName: string;
  amountCents: number;
  currency: string;
  successUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
};

export async function createStripeCheckout(input: CheckoutInput) {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) return null;

  const body = new URLSearchParams({
    mode: "payment",
    submit_type: "book",
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    customer_email: input.customerEmail,
    "line_items[0][price_data][currency]": input.currency.toLowerCase(),
    "line_items[0][price_data][product_data][name]": input.serviceName,
    "line_items[0][price_data][unit_amount]": String(input.amountCents),
    "line_items[0][quantity]": "1",
    "metadata[appointment_id]": input.appointmentId,
  });

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": input.idempotencyKey,
    },
    body,
  });

  const payload = await response.json() as { id?: string; url?: string; error?: { message?: string } };
  if (!response.ok || !payload.id || !payload.url) {
    throw new Error(payload.error?.message ?? "STRIPE_CHECKOUT_FAILED");
  }
  return { id: payload.id, url: payload.url };
}

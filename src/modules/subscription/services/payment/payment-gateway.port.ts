/**
 * IPaymentGateway port — real implementation (Razorpay/Stripe) is deferred.
 * Stub is wired in this iteration.
 */
export interface PaymentCheckoutInput {
  vendorId: bigint;
  invoiceId: bigint;
  amount: number;
  currency: 'INR';
}

export interface PaymentCheckoutResult {
  paymentUrl: string;
  gatewayRef: string;
}

export interface IPaymentGateway {
  createCheckout(input: PaymentCheckoutInput): Promise<PaymentCheckoutResult>;
}

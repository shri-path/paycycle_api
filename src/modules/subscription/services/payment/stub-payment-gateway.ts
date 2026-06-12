/**
 * StubPaymentGateway — returns a deterministic fake paymentUrl.
 * Replace with Razorpay/Stripe adapter in a future US.
 */
import { randomUUID } from 'crypto';
import {
  IPaymentGateway,
  PaymentCheckoutInput,
  PaymentCheckoutResult,
} from './payment-gateway.port';

export class StubPaymentGateway implements IPaymentGateway {
  createCheckout(input: PaymentCheckoutInput): Promise<PaymentCheckoutResult> {
    return Promise.resolve({
      paymentUrl: `https://payment.paycycle.app/invoice/${input.invoiceId.toString()}`,
      gatewayRef: `stub_${randomUUID()}`,
    });
  }
}

import type { Order, PolicyResult } from './types';

const GENERIC =
  'Hi there, thanks for reaching out. A member of our support team will review your request and reply within one business day.';

// Customer-facing text only; escalations never reveal internal reason codes.
export function buildReply(result: PolicyResult, order: Order | null): string {
  const name = order ? order.customer_name.trim().split(/\s+/)[0] : 'there';
  const orderId = order?.id ?? '';

  if (result.decision === 'escalate') return GENERIC;
  if (result.decision === 'approve') {
    const amount = `$${(result.refund_amount_cents / 100).toFixed(2)}`;
    return `Hi ${name}, good news: your refund of ${amount} for order ${orderId} has been approved. It will appear on your original payment method within 5–7 business days.`;
  }

  switch (result.reason_code) {
    case 'ORDER_NOT_FOUND':
      return "Hi there, we couldn't find that order number. Please reply with your order number in the format ORD-1234.";
    case 'ALREADY_REFUNDED':
      return `Hi ${name}, order ${orderId} has already been refunded, so there's nothing further to process.`;
    case 'NOT_DELIVERED':
      return `Hi ${name}, order ${orderId} hasn't been delivered yet. Once it arrives, we'll be happy to help.`;
    case 'GIFT_CARD_NONREFUNDABLE':
      return `Hi ${name}, gift cards are not refundable. We're sorry for any inconvenience.`;
    case 'FINAL_SALE':
      return `Hi ${name}, order ${orderId} was a final-sale item, so it isn't eligible for a refund unless it arrived damaged or incorrect.`;
    case 'OUTSIDE_WINDOW':
      return `Hi ${name}, order ${orderId} is outside our return window, so we're unable to issue a refund.`;
    default:
      return GENERIC;
  }
}

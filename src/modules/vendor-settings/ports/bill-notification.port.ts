/**
 * BillNotificationPort — strategy interface for sending bills and reminders.
 * Must not throw — log + resolve. Returns true on accepted-for-delivery.
 */

export interface BillNotificationPort {
  /** Send a monthly bill to a customer. Returns true on accepted. */
  sendBill(phone: string, text: string): Promise<boolean>;

  /** Send a payment reminder. Returns true on accepted. */
  sendReminder(phone: string, text: string): Promise<boolean>;
}

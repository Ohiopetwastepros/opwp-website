export const PAYMENT_VIEWS = {
  active: 'Active failed payments',
  awaiting_approval: 'Awaiting approval',
  sent: 'Sent messages',
  attention: 'Needs attention',
  resolved: 'Payment recorded / outreach stopped',
};

export function paymentInView(row, view) {
  const resolved = row.status === 'payment_recorded' || ['paid', 'voided', 'settled', 'payment_recorded'].includes(row.payment_state);
  const active = !resolved && (row.sms_status || row.status) !== 'cancelled';
  switch (view) {
    case 'awaiting_approval': return active && row.status === 'awaiting_approval';
    case 'sent': return (row.sms_status || row.status) === 'sent';
    case 'attention': return active && (row.status === 'failed' || Boolean(row.sync_error) || row.payment_state === 'needs_review');
    case 'resolved': return resolved;
    default: return active;
  }
}

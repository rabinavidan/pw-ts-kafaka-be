// Lightweight per-event-type schema contracts, checked against real Kafka
// messages produced by the running services. Catches drift between what a
// producer actually emits and what consumers (the notification service,
// the UI event feed, other services) are written to expect — e.g. two code
// paths publishing the same event-type with different payload shapes.

export type FieldType = 'string' | 'number' | 'boolean' | 'object' | 'array';

export interface ContractSpec {
  required: Record<string, FieldType>;
}

const orderFields: Record<string, FieldType> = {
  orderId: 'string',
  userId: 'string',
  status: 'string',
  amount: 'number',
  currency: 'string',
  items: 'array',
  createdAt: 'string',
};

const paymentFields: Record<string, FieldType> = {
  paymentId: 'string',
  orderId: 'string',
  status: 'string',
  amount: 'number',
  currency: 'string',
  method: 'string',
  processedAt: 'string',
};

const paymentFailedFields: Record<string, FieldType> = {
  paymentId: 'string',
  orderId: 'string',
  status: 'string',
  amount: 'number',
  currency: 'string',
  method: 'string',
  failureReason: 'string',
  failedAt: 'string',
};

export const eventContracts: Record<string, ContractSpec> = {
  'order.created':   { required: orderFields },
  'order.confirmed': { required: orderFields },
  'order.cancelled': { required: orderFields },
  'order.deleted':   { required: { eventType: 'string', orderId: 'string' } },

  'payment.initiated': { required: paymentFields },
  'payment.processed': { required: paymentFields },
  'payment.refunded':  { required: paymentFields },
  'payment.deleted':   { required: { eventType: 'string', paymentId: 'string' } },
  'payment.failed':    { required: paymentFailedFields },

  'message.poisoned': { required: {
    originalTopic: 'string', originalEventType: 'string',
    failureReason: 'string', error: 'string', failedAt: 'string',
  } },
};

function typeOf(value: unknown): FieldType | 'undefined' | 'null' {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value as FieldType;
}

/** Returns a list of human-readable violations; empty means the payload matches the contract. */
export function checkContract(eventType: string, payload: unknown): string[] {
  const spec = eventContracts[eventType];
  if (!spec) return [`No contract registered for event-type "${eventType}"`];
  if (typeof payload !== 'object' || payload === null) return ['Payload is not an object'];

  const obj = payload as Record<string, unknown>;
  const violations: string[] = [];
  for (const [field, expected] of Object.entries(spec.required)) {
    const actual = typeOf(obj[field]);
    if (actual === 'undefined') violations.push(`Missing required field "${field}"`);
    else if (actual !== expected) violations.push(`Field "${field}" expected type ${expected}, got ${actual}`);
  }
  return violations;
}

export function assertMatchesContract(eventType: string, payload: unknown): void {
  const violations = checkContract(eventType, payload);
  if (violations.length) {
    throw new Error(`Contract violation for event-type "${eventType}":\n  - ${violations.join('\n  - ')}`);
  }
}

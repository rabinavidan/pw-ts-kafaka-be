import { v4 as uuidv4 } from 'uuid';
import { OrderEvent, PaymentEvent, NotificationEvent, AuditEvent } from '../models/kafka.model';
import { CreateOrderRequest } from '../models/api.model';

export function createOrderEvent(overrides: Partial<OrderEvent> = {}): OrderEvent {
  return {
    orderId: uuidv4(),
    userId: uuidv4(),
    status: 'created',
    amount: parseFloat((Math.random() * 500 + 10).toFixed(2)),
    currency: 'USD',
    items: [
      {
        productId: uuidv4(),
        quantity: Math.ceil(Math.random() * 5),
        price: parseFloat((Math.random() * 100 + 5).toFixed(2)),
      },
    ],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

export function createPaymentEvent(overrides: Partial<PaymentEvent> = {}): PaymentEvent {
  return {
    paymentId: uuidv4(),
    orderId: uuidv4(),
    status: 'pending',
    amount: parseFloat((Math.random() * 500 + 10).toFixed(2)),
    currency: 'USD',
    method: 'credit_card',
    processedAt: new Date().toISOString(),
    ...overrides,
  };
}

export function createNotificationEvent(overrides: Partial<NotificationEvent> = {}): NotificationEvent {
  return {
    notificationId: uuidv4(),
    userId: uuidv4(),
    type: 'order_update',
    channel: 'email',
    payload: { subject: 'Order Update', body: 'Your order has been updated.' },
    sentAt: new Date().toISOString(),
    ...overrides,
  };
}

export function createAuditEvent(overrides: Partial<AuditEvent> = {}): AuditEvent {
  return {
    auditId: uuidv4(),
    action: 'CREATE',
    resource: 'order',
    resourceId: uuidv4(),
    userId: uuidv4(),
    timestamp: new Date().toISOString(),
    metadata: {},
    ...overrides,
  };
}

export function createOrderRequest(overrides: Partial<CreateOrderRequest> = {}): CreateOrderRequest {
  return {
    userId: uuidv4(),
    items: [{ productId: uuidv4(), quantity: 1 }],
    currency: 'USD',
    ...overrides,
  };
}

export function randomId(): string {
  return uuidv4();
}

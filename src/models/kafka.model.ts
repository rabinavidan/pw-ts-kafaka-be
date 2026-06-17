export interface KafkaMessage<T = unknown> {
  key: string;
  value: T;
  headers?: Record<string, string>;
  timestamp?: string;
  partition?: number;
  offset?: string;
}

export interface OrderEvent {
  orderId: string;
  userId: string;
  status: OrderStatus;
  amount: number;
  currency: string;
  items: OrderItem[];
  createdAt: string;
}

export type OrderStatus = 'created' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';

export interface OrderItem {
  productId: string;
  quantity: number;
  price: number;
}

export interface PaymentEvent {
  paymentId: string;
  orderId: string;
  status: PaymentStatus;
  amount: number;
  currency: string;
  method: PaymentMethod;
  processedAt: string;
}

export type PaymentStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'refunded';
export type PaymentMethod = 'credit_card' | 'debit_card' | 'bank_transfer' | 'digital_wallet';

export interface NotificationEvent {
  notificationId: string;
  userId: string;
  type: NotificationType;
  channel: NotificationChannel;
  payload: Record<string, unknown>;
  sentAt: string;
}

export type NotificationType = 'order_update' | 'payment_update' | 'promotional' | 'system';
export type NotificationChannel = 'email' | 'sms' | 'push' | 'webhook';

export interface AuditEvent {
  auditId: string;
  action: string;
  resource: string;
  resourceId: string;
  userId: string;
  timestamp: string;
  metadata: Record<string, unknown>;
}

export interface ConsumedMessage<T = unknown> {
  topic: string;
  partition: number;
  offset: string;
  key: string | null;
  value: T;
  headers: Record<string, string>;
  timestamp: string;
}

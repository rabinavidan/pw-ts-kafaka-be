export interface Order {
  id: string;
  userId: string;
  status: 'created' | 'confirmed' | 'cancelled';
  amount: number;
  currency: string;
  items: { productId: string; quantity: number; price: number }[];
  createdAt: string;
  updatedAt: string;
}

export interface Payment {
  id: string;
  orderId: string;
  status: 'pending' | 'failed' | 'processed' | 'refunded';
  amount: number;
  currency: string;
  method: string;
  createdAt: string;
}

export interface KafkaEvent {
  id: string;
  topic: string;
  eventType: string;
  key: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface HealthStatus {
  status: 'healthy' | 'unhealthy';
  version: string;
  uptime: number;
  dependencies: { name: string; status: string; latency: number }[];
}

export interface Toast {
  id: string;
  type: 'success' | 'error';
  message: string;
}

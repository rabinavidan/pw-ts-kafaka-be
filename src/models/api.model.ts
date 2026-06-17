export interface ApiResponse<T = unknown> {
  status: number;
  data: T;
  headers: Record<string, string>;
  duration: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasNext: boolean;
}

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  dependencies: DependencyHealth[];
}

export interface DependencyHealth {
  name: string;
  status: 'up' | 'down' | 'degraded';
  latency?: number;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  traceId?: string;
}

export interface Order {
  id: string;
  userId: string;
  status: string;
  amount: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateOrderRequest {
  userId: string;
  items: Array<{ productId: string; quantity: number }>;
  currency?: string;
}

export interface Payment {
  id: string;
  orderId: string;
  status: string;
  amount: number;
  currency: string;
  method: string;
  createdAt: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

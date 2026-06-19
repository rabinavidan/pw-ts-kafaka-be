import { APIRequestContext } from '@playwright/test';
import { apiConfig } from '../config/api.config';
import { ApiResponse } from '../models/api.model';
import { logger } from '../utils/logger';
import { retry } from '../utils/retry';

export class ApiHelper {
  constructor(private readonly request: APIRequestContext, private readonly baseUrlOverride?: string) {}

  async get<T>(path: string, params?: Record<string, string>): Promise<ApiResponse<T>> {
    const url = this.buildUrl(path, params);
    const start = Date.now();

    logger.info(`GET ${url}`);
    const response = await this.request.get(url, { headers: this.buildHeaders() });
    const duration = Date.now() - start;

    const data = await this.parseBody<T>(response);
    logger.info(`GET ${url} -> ${response.status()} (${duration}ms)`);

    return { status: response.status(), data, headers: response.headers() as Record<string, string>, duration };
  }

  async post<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    const url = this.buildUrl(path);
    const start = Date.now();

    logger.info(`POST ${url}`, { body });
    const response = await this.request.post(url, { headers: this.buildHeaders(), data: body });
    const duration = Date.now() - start;

    const data = await this.parseBody<T>(response);
    logger.info(`POST ${url} -> ${response.status()} (${duration}ms)`);

    return { status: response.status(), data, headers: response.headers() as Record<string, string>, duration };
  }

  async put<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    const url = this.buildUrl(path);
    const start = Date.now();

    logger.info(`PUT ${url}`);
    const response = await this.request.put(url, { headers: this.buildHeaders(), data: body });
    const duration = Date.now() - start;

    const data = await this.parseBody<T>(response);
    logger.info(`PUT ${url} -> ${response.status()} (${duration}ms)`);

    return { status: response.status(), data, headers: response.headers() as Record<string, string>, duration };
  }

  async patch<T>(path: string, body?: unknown): Promise<ApiResponse<T>> {
    const url = this.buildUrl(path);
    const start = Date.now();

    logger.info(`PATCH ${url}`);
    const response = await this.request.patch(url, { headers: this.buildHeaders(), data: body });
    const duration = Date.now() - start;

    const data = await this.parseBody<T>(response);
    logger.info(`PATCH ${url} -> ${response.status()} (${duration}ms)`);

    return { status: response.status(), data, headers: response.headers() as Record<string, string>, duration };
  }

  async delete<T>(path: string): Promise<ApiResponse<T>> {
    const url = this.buildUrl(path);
    const start = Date.now();

    logger.info(`DELETE ${url}`);
    const response = await this.request.delete(url, { headers: this.buildHeaders() });
    const duration = Date.now() - start;

    const data = await this.parseBody<T>(response);
    logger.info(`DELETE ${url} -> ${response.status()} (${duration}ms)`);

    return { status: response.status(), data, headers: response.headers() as Record<string, string>, duration };
  }

  async getWithRetry<T>(path: string, params?: Record<string, string>, retries = 3): Promise<ApiResponse<T>> {
    return retry(() => this.get<T>(path, params), { attempts: retries, delay: 1000 });
  }

  async postWithRetry<T>(path: string, body?: unknown, retries = 3): Promise<ApiResponse<T>> {
    return retry(() => this.post<T>(path, body), { attempts: retries, delay: 1000 });
  }

  private buildUrl(path: string, params?: Record<string, string>): string {
    const base = (this.baseUrlOverride || apiConfig.baseUrl).replace(/\/$/, '');
    const normalizedPath = path.startsWith('/') ? path : `/${path}`;
    const url = `${base}${normalizedPath}`;

    if (params && Object.keys(params).length > 0) {
      const query = new URLSearchParams(params).toString();
      return `${url}?${query}`;
    }

    return url;
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { ...apiConfig.headers };
    if (apiConfig.apiKey) headers['X-API-Key'] = apiConfig.apiKey;
    return headers;
  }

  private async parseBody<T>(response: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> {
    const contentType = response.headers()['content-type'] || '';
    if (contentType.includes('application/json')) {
      return response.json() as Promise<T>;
    }
    return response.text() as unknown as T;
  }
}

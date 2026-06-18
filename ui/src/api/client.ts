export class ApiError extends Error {
  constructor(
    public status: number,
    public data: { code: string; message: string },
  ) {
    super(data.message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({ code: 'PARSE_ERROR', message: res.statusText }));
  if (!res.ok) throw new ApiError(res.status, json);
  return json as T;
}

export const api = {
  get:  <T>(path: string)               => request<T>('GET',  path),
  post: <T>(path: string, body: unknown) => request<T>('POST', path, body),
  put:  <T>(path: string, body?: unknown) => request<T>('PUT',  path, body),
};

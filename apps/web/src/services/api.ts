import { providerCatalogSchema } from '@studio/contracts';
import { isTauri } from '@tauri-apps/api/core';
import { resolveApiBase } from '../platform/api-base';
export const apiBase = resolveApiBase(
  import.meta.env.VITE_API_BASE_URL,
  isTauri() && import.meta.env.PROD,
);
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}
export const providerApi = {
  async catalog() {
    const response = await fetch(`${apiBase}/providers`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new ApiError(`模型服务连接失败（${response.status}）`, response.status);
    return providerCatalogSchema.parse(await response.json());
  },
};

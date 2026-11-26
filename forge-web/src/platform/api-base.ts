/** Packaged assets have no Vite proxy. Only loopback may use plain HTTP. */
export function resolveApiBase(configured: string | undefined, desktop: boolean): string {
  const value = configured?.trim().replace(/\/+$/, '');
  if (!value) return desktop ? 'http://127.0.0.1:3009/api' : '/api';
  const url = new URL(value);
  if (
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('API 地址须使用 HTTPS 或本机 HTTP 地址，且不能包含凭据、查询或片段');
  }
  return value;
}

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { config as loadEnv } from 'dotenv';
import { z } from 'zod';

export const workspaceRoot = fileURLToPath(new URL('../../../', import.meta.url));
loadEnv({ path: resolve(workspaceRoot, '.env') });
const environmentSchema = z
  .object({
    PROVIDER: z.enum(['demo', 'openai', 'deepseek', 'zhipu']).default('demo'),
    PORT: z.coerce.number().int().min(1024).max(65535).default(3007),
    WEB_ORIGIN: z.string().url().default('http://127.0.0.1:5177'),
    DESKTOP_CLIENT_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    DATA_DIR: z.string().default('.data'),
    OPENAI_API_KEY: z.string().optional(),
    OPENAI_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
    OPENAI_PROXY_URL: z
      .union([
        z.literal(''),
        z
          .string()
          .url()
          .regex(/^https?:\/\//),
      ])
      .optional(),
    OPENAI_TEXT_MODEL: z.string().optional(),
    OPENAI_TEXT_MODELS: z.string().default(''),
    DEEPSEEK_API_KEY: z.string().optional(),
    DEEPSEEK_BASE_URL: z.string().url().default('https://api.deepseek.com'),
    DEEPSEEK_TEXT_MODEL: z.string().trim().min(1).default('deepseek-flash'),
    DEEPSEEK_TEXT_MODELS: z.string().default(''),
    DEEPSEEK_PROXY_URL: z
      .union([
        z.literal(''),
        z
          .string()
          .url()
          .regex(/^https?:\/\//),
      ])
      .optional(),
    ZHIPU_API_KEY: z.string().optional(),
    ZHIPU_BASE_URL: z.string().url().default('https://open.bigmodel.cn/api/v1'),
    ZHIPU_TEXT_MODEL: z.string().trim().min(1).default('glm-5.3'),
    ZHIPU_TEXT_MODELS: z.string().default('glm-5.2,glm-5.3-flash'),
    ZHIPU_PROXY_URL: z
      .union([
        z.literal(''),
        z
          .string()
          .url()
          .regex(/^https?:\/\//),
      ])
      .optional(),
    PROVIDER_TIMEOUT_MS: z.coerce.number().int().min(1000).max(600000).default(180000),
    MAX_CONCURRENT_JOBS: z.coerce.number().int().min(1).max(8).default(2),
  })
  .superRefine((env, ctx) => {
    if (env.PROVIDER === 'zhipu') {
      if (!env.ZHIPU_API_KEY?.trim())
        ctx.addIssue({ code: 'custom', path: ['ZHIPU_API_KEY'], message: 'ZHIPU_API_KEY 必填' });
      for (const key of ['ZHIPU_BASE_URL'] as const)
        if (!env[key].startsWith('https://'))
          ctx.addIssue({ code: 'custom', path: [key], message: '智谱模型端点必须使用 HTTPS' });
    }
    if (env.PROVIDER === 'openai') {
      for (const key of ['OPENAI_API_KEY', 'OPENAI_TEXT_MODEL'] as const) {
        if (!env[key]?.trim())
          ctx.addIssue({ code: 'custom', path: [key], message: `${key} 必填` });
      }
      if (!env.OPENAI_BASE_URL.startsWith('https://')) {
        ctx.addIssue({
          code: 'custom',
          path: ['OPENAI_BASE_URL'],
          message: '模型端点必须使用 HTTPS',
        });
      }
    }
    if (env.PROVIDER === 'deepseek') {
      if (!env.DEEPSEEK_API_KEY?.trim())
        ctx.addIssue({
          code: 'custom',
          path: ['DEEPSEEK_API_KEY'],
          message: 'DEEPSEEK_API_KEY 必填',
        });
      if (!env.DEEPSEEK_BASE_URL.startsWith('https://'))
        ctx.addIssue({
          code: 'custom',
          path: ['DEEPSEEK_BASE_URL'],
          message: '模型端点必须使用 HTTPS',
        });
    }
  });
export type AppConfig = z.infer<typeof environmentSchema>;
export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return environmentSchema.parse(env);
}
export const APP_CONFIG = Symbol('APP_CONFIG');

export function allowedWebOrigins(value: string, desktopClient = false): string[] {
  const origin = new URL(value);
  const origins = new Set([origin.origin]);
  if (origin.hostname === '127.0.0.1' || origin.hostname === 'localhost') {
    origin.hostname = origin.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
    origins.add(origin.origin);
  }
  if (desktopClient) {
    origins.add('tauri://localhost');
    origins.add('http://tauri.localhost');
  }
  return [...origins];
}

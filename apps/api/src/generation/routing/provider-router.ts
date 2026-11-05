import { BadRequestException } from '@nestjs/common';
import {
  modelIdSchema,
  type GenerationInput,
  type ModelSelection,
  type ProviderCatalog,
  type GenerationExecution,
} from '@studio/contracts';
import type { AppConfig } from '../../config.js';
import { OpenAIProvider } from '../providers/openai/openai.provider.js';
import { DeepSeekProvider } from '../providers/deepseek/deepseek.provider.js';
import { ZhipuProvider } from '../providers/zhipu/zhipu.provider.js';
import type { GenerationGateway, StructuredTextRequest } from '../ports.js';
import { ModelInvocationLimiter } from './model-limiter.js';

type RemoteProvider = Exclude<ModelSelection['provider'], 'demo'>;
const models = (...values: (string | undefined)[]) =>
  [
    ...new Set(values.flatMap((value) => value?.split(',') ?? []).map((value) => value.trim())),
  ].filter((value) => modelIdSchema.safeParse(value).success);

/** Snapshot each request's selected text model before starting project generation. */
export class ProviderRouter implements GenerationGateway {
  readonly mode: AppConfig['PROVIDER'];
  private readonly adapters: Record<
    RemoteProvider,
    OpenAIProvider | DeepSeekProvider | ZhipuProvider
  >;
  private readonly description: ProviderCatalog;
  private readonly limiter: ModelInvocationLimiter;
  constructor(config: AppConfig) {
    this.mode = config.PROVIDER;
    this.limiter = new ModelInvocationLimiter(config.MAX_CONCURRENT_JOBS);
    this.adapters = {
      openai: new OpenAIProvider(config, {}, this.limiter),
      deepseek: new DeepSeekProvider(config, this.limiter),
      zhipu: new ZhipuProvider(config, this.limiter),
    };
    const capability = (
      key: string | undefined,
      endpoint: string,
      suggestions: string[],
      keyName: string,
    ) => {
      const unavailableReason = !key?.trim()
        ? `请在服务端 .env 配置 ${keyName}，然后重启服务`
        : !endpoint.startsWith('https://')
          ? '模型端点必须使用 HTTPS'
          : undefined;
      return {
        kind: 'html' as const,
        available: !unavailableReason,
        unavailableReason,
        models: suggestions,
        defaultModel: suggestions[0],
      };
    };
    const providers: ProviderCatalog['providers'] = [
      {
        id: 'demo',
        name: '本地演示',
        capabilities: [
          { kind: 'html', available: true, models: ['local-sample'], defaultModel: 'local-sample' },
        ],
      },
      {
        id: 'openai',
        name: 'OpenAI',
        capabilities: [
          capability(
            config.OPENAI_API_KEY,
            config.OPENAI_BASE_URL,
            models(config.OPENAI_TEXT_MODEL, config.OPENAI_TEXT_MODELS),
            'OPENAI_API_KEY',
          ),
        ],
      },
      {
        id: 'deepseek',
        name: 'DeepSeek',
        capabilities: [
          capability(
            config.DEEPSEEK_API_KEY,
            config.DEEPSEEK_BASE_URL,
            models(config.DEEPSEEK_TEXT_MODEL, config.DEEPSEEK_TEXT_MODELS),
            'DEEPSEEK_API_KEY',
          ),
        ],
      },
      {
        id: 'zhipu',
        name: '智谱',
        capabilities: [
          {
            ...capability(
              config.ZHIPU_API_KEY,
              config.ZHIPU_BASE_URL,
              models(config.ZHIPU_TEXT_MODEL, config.ZHIPU_TEXT_MODELS),
              'ZHIPU_API_KEY',
            ),
            reasoningEfforts: ['low', 'high', 'max'],
            defaultReasoningEffort: 'high',
          },
        ],
      },
    ];
    const defaultCapability = providers.find((item) => item.id === config.PROVIDER)!
      .capabilities[0]!;
    const defaultModel = defaultCapability.defaultModel;
    this.description = {
      defaultProvider: this.mode,
      defaults: defaultModel
        ? {
            html: {
              provider: this.mode,
              model: defaultModel,
              ...(defaultCapability.defaultReasoningEffort
                ? { reasoningEffort: defaultCapability.defaultReasoningEffort }
                : {}),
            },
          }
        : {},
      providers,
    };
  }
  catalog(): ProviderCatalog {
    return structuredClone(this.description);
  }
  resolveInput(input: GenerationInput): GenerationInput {
    const selection = input.modelSelection ?? this.description.defaults.html;
    if (!selection) throw new BadRequestException('请先选择服务商与模型');
    const capability = this.description.providers.find((item) => item.id === selection.provider)
      ?.capabilities[0];
    if (!capability?.available)
      throw new BadRequestException(capability?.unavailableReason ?? '服务商不可用');
    if (selection.provider === 'demo' && selection.model !== 'local-sample')
      throw new BadRequestException('本地演示仅支持 local-sample');
    const reasoningEffort = selection.reasoningEffort ?? capability.defaultReasoningEffort;
    if (reasoningEffort && !capability.reasoningEfforts?.includes(reasoningEffort))
      throw new BadRequestException('当前服务商不支持该思考等级');
    return {
      ...input,
      modelSelection: { ...selection, ...(reasoningEffort ? { reasoningEffort } : {}) },
    };
  }
  private remote(selection: ModelSelection) {
    if (selection.provider === 'demo')
      throw new BadRequestException('本地演示由 HTML 项目提供规则样例');
    return this.adapters[selection.provider];
  }
  complete(
    selection: ModelSelection,
    request: StructuredTextRequest,
    signal: AbortSignal,
  ): Promise<unknown> {
    const resolved = this.resolveInput({
      kind: 'html',
      prompt: 'HTML 分镜规划',
      aspect: 'landscape',
      style: 'editorial',
      slides: 5,
      modelSelection: selection,
    }).modelSelection!;
    const adapter = this.remote(resolved);
    return adapter.complete(
      resolved.model,
      { ...request, reasoningEffort: resolved.reasoningEffort },
      signal,
    );
  }
  generate(input: GenerationInput, signal: AbortSignal, execution?: GenerationExecution) {
    const resolved = this.resolveInput(input);
    const adapter = this.remote(resolved.modelSelection!);
    return adapter.generate(resolved, signal, execution);
  }
  async onModuleDestroy() {
    await Promise.all(Object.values(this.adapters).map((adapter) => adapter.onModuleDestroy()));
  }
}

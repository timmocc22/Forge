import type { Artifact, GenerationInput, GenerationExecution } from '@studio/contracts';
import type { ModelInvocationLimiter } from '../../routing/model-limiter.js';
import type { AppConfig } from '../../../config.js';
import { OpenAIProvider } from '../openai/openai.provider.js';
import type { GenerationProvider, StructuredTextRequest } from '../../ports.js';

/** Adapt the text Responses endpoint; storyboard JSON is validated by the project service. */
export class ZhipuProvider implements GenerationProvider {
  readonly mode = 'zhipu' as const;
  private readonly text: OpenAIProvider;
  constructor(config: AppConfig, limiter?: ModelInvocationLimiter) {
    this.text = new OpenAIProvider(
      {
        ...config,
        OPENAI_API_KEY: config.ZHIPU_API_KEY,
        OPENAI_BASE_URL: config.ZHIPU_BASE_URL,
        OPENAI_PROXY_URL: config.ZHIPU_PROXY_URL,
        OPENAI_TEXT_MODEL: config.ZHIPU_TEXT_MODEL,
      },
      // GLM-5.3 always thinks and rejects reasoning.effort = 'none'.
      { name: '智谱', reasoningEffort: 'high', structuredOutput: 'json_object' },
      limiter,
    );
  }
  complete(model: string, request: StructuredTextRequest, signal: AbortSignal) {
    return this.text.complete(model, request, signal);
  }
  generate(
    input: GenerationInput,
    signal: AbortSignal,
    execution?: GenerationExecution,
  ): Promise<Artifact> {
    return this.text.generate(input, signal, execution);
  }
  async onModuleDestroy() {
    await this.text.onModuleDestroy();
  }
}

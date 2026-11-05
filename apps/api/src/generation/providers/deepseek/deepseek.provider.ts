import type { Artifact, GenerationInput, GenerationExecution } from '@studio/contracts';
import type { ModelInvocationLimiter } from '../../routing/model-limiter.js';
import type { AppConfig } from '../../../config.js';
import { OpenAIProvider } from '../openai/openai.provider.js';
import type { GenerationProvider, StructuredTextRequest } from '../../ports.js';

/** Keep DeepSeek credentials and proxy independent from other text providers. */
export class DeepSeekProvider implements GenerationProvider {
  readonly mode = 'deepseek' as const;
  private readonly text: OpenAIProvider;
  constructor(config: AppConfig, limiter?: ModelInvocationLimiter) {
    this.text = new OpenAIProvider(
      {
        ...config,
        OPENAI_API_KEY: config.DEEPSEEK_API_KEY,
        OPENAI_BASE_URL: config.DEEPSEEK_BASE_URL,
        OPENAI_PROXY_URL: config.DEEPSEEK_PROXY_URL,
        OPENAI_TEXT_MODEL: config.DEEPSEEK_TEXT_MODEL,
      },
      { name: 'DeepSeek', reasoningEffort: 'none' },
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

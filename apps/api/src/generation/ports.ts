import type {
  Artifact,
  GenerationInput,
  GenerationExecution,
  ModelSelection,
  ReasoningEffort,
  ProviderCatalog,
} from '@studio/contracts';
export const GENERATION_PROVIDER = Symbol('GENERATION_PROVIDER');
export interface GenerationProvider {
  readonly mode: ModelSelection['provider'];
  generate(
    input: GenerationInput,
    signal: AbortSignal,
    execution?: GenerationExecution,
  ): Promise<Artifact>;
}
/** Model capabilities consumed by HTTP and project workflows. */
export interface GenerationGateway extends GenerationProvider {
  catalog(): ProviderCatalog;
  resolveInput(input: GenerationInput): GenerationInput;
  complete(
    selection: ModelSelection,
    request: StructuredTextRequest,
    signal: AbortSignal,
  ): Promise<unknown>;
}
export interface StructuredTextRequest {
  tools?: {
    definitions: {
      type: 'function';
      name: string;
      description: string;
      parameters: unknown;
      strict: boolean;
    }[];
    execute(name: string, argumentsJson: string): Promise<unknown>;
  };
  reasoningEffort?: ReasoningEffort;
  instructions: string;
  input: string;
  schema: unknown;
  name: string;
}
export class ProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

import type { ModelSelection } from '@studio/contracts';
import type { GenerationGateway } from '../../generation/ports.js';

export function resolveProjectModel(
  provider: Pick<GenerationGateway, 'resolveInput'>,
  selection?: ModelSelection,
) {
  return provider.resolveInput({
    kind: 'html',
    prompt: '项目创作',
    slides: 3,
    style: 'editorial',
    aspect: 'landscape',
    modelSelection: selection,
  }).modelSelection!;
}

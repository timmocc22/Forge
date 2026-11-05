import { Controller, Get, Inject } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config.js';
import { GENERATION_PROVIDER, type GenerationGateway } from '../ports.js';

@Controller('api')
export class GenerationController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(GENERATION_PROVIDER) private readonly provider: GenerationGateway,
  ) {}
  @Get('health') health() {
    return { status: 'ok', provider: this.config.PROVIDER, version: '0.1.0' };
  }
  @Get('providers') providers() {
    return this.provider.catalog();
  }
}

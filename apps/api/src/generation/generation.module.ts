import { Module } from '@nestjs/common';
import { ConfigModule } from '../config.module.js';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { GenerationController } from './http/generation.controller.js';
import { GENERATION_PROVIDER } from './ports.js';
import { ProviderRouter } from './routing/provider-router.js';

@Module({
  imports: [ConfigModule],
  controllers: [GenerationController],
  providers: [
    {
      provide: GENERATION_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => new ProviderRouter(config),
    },
  ],
  exports: [GENERATION_PROVIDER],
})
export class GenerationModule {}

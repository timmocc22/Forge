import { Module } from '@nestjs/common';
import { APP_CONFIG, readConfig } from './config.js';

@Module({
  providers: [{ provide: APP_CONFIG, useFactory: readConfig }],
  exports: [APP_CONFIG],
})
export class ConfigModule {}

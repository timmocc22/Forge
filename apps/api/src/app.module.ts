import { Module } from '@nestjs/common';
import { ConfigModule } from './config.module.js';
import { GenerationModule } from './generation/generation.module.js';
import { ProjectsModule } from './projects/projects.module.js';

@Module({ imports: [ConfigModule, GenerationModule, ProjectsModule] })
export class AppModule {}

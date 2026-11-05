import { ContextModule } from '../context/context.module.js';
import { ContextService } from '../context/context.service.js';
import { Module } from '@nestjs/common';
import { ConfigModule } from '../config.module.js';
import { APP_CONFIG, workspaceRoot, type AppConfig } from '../config.js';
import { GenerationModule } from '../generation/generation.module.js';
import { GENERATION_PROVIDER, type GenerationGateway } from '../generation/ports.js';
import { resolve } from 'node:path';
import { HtmlProjectController } from './http/project.controller.js';
import { HtmlProjectService } from './authoring/project.service.js';
import { ProjectRepository } from './persistence/project.repository.js';
import { ConversationService } from './conversation/conversation.service.js';
import { PROJECT_STORE, type ProjectStore } from './ports/project-store.js';
import { ProjectCommands } from './runtime/project-commands.js';
import { ProjectTasks } from './runtime/project-tasks.js';

@Module({
  imports: [ConfigModule, GenerationModule, ContextModule],
  controllers: [HtmlProjectController],
  providers: [
    {
      provide: PROJECT_STORE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new ProjectRepository(resolve(workspaceRoot, config.DATA_DIR, 'html-projects')),
    },
    { provide: ProjectTasks, useFactory: () => new ProjectTasks() },
    {
      provide: ProjectCommands,
      inject: [PROJECT_STORE, HtmlProjectService, ConversationService, ProjectTasks],
      useFactory: (store: ProjectStore, projects: HtmlProjectService, conversations: ConversationService, tasks: ProjectTasks) => new ProjectCommands(store, projects, conversations, tasks),
    },
    {
      provide: HtmlProjectService,
      inject: [PROJECT_STORE, GENERATION_PROVIDER, ProjectTasks],
      useFactory: (
        repository: ProjectStore,
        provider: GenerationGateway,
        tasks: ProjectTasks,
      ) => new HtmlProjectService(repository, provider, tasks),
    },
    {
      provide: ConversationService,
      inject: [PROJECT_STORE, GENERATION_PROVIDER, ProjectTasks, ContextService],
      useFactory: (
        repository: ProjectStore,
        provider: GenerationGateway,
        tasks: ProjectTasks,
        context: ContextService,
      ) => new ConversationService(repository, provider, tasks, context),
    },
  ],
})
export class ProjectsModule {}

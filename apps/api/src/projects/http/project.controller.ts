import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { z } from 'zod';
import {
  askHtmlSceneSchema, enqueueProjectCommandSchema, projectCommandSchema,
  createHtmlProjectSchema,
  runHtmlProjectSchema,
  saveHtmlProjectSchema,
} from '@studio/contracts';
import { ProjectCommands } from '../runtime/project-commands.js';
import { HtmlProjectService } from '../authoring/project.service.js';
import { ConversationService } from '../conversation/conversation.service.js';

@Controller('api/html-projects')
export class HtmlProjectController {
  constructor(
    @Inject(HtmlProjectService) private readonly projects: HtmlProjectService,
    @Inject(ConversationService) private readonly conversations: ConversationService,
    @Inject(ProjectCommands) private readonly commands: ProjectCommands,
  ) {}
  @Get('storage/status') storageStatus() { return this.projects.storageStatus(); }
  @Get() list() {
    return this.projects.list();
  }
  @Get(':id') get(@Param('id', ParseUUIDPipe) id: string) {
    return this.projects.get(id);
  }
  @Post() create(@Body() body: unknown) {
    return this.projects.create(createHtmlProjectSchema.parse(body));
  }
  @Patch(':id') save(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.projects.save(id, saveHtmlProjectSchema.parse(body));
  }
  @Get(':id/commands')
  queue(@Param('id', ParseUUIDPipe) id: string) { return this.commands.list(id); }
  @Post(':id/commands')
  @HttpCode(202)
  enqueue(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.commands.enqueue(id, projectCommandSchema.parse(enqueueProjectCommandSchema.parse(body)));
  }
  @Patch(':id/commands/:commandId')
  changeCommand(@Param('id', ParseUUIDPipe) id: string, @Param('commandId', ParseUUIDPipe) commandId: string, @Body() body: unknown) {
    const { action } = z.object({ action: z.enum(['remove', 'retry', 'interrupt']) }).strict().parse(body);
    return this.commands.change(id, commandId, action);
  }
  @Delete(':id/commands')
  clearCommands(@Param('id', ParseUUIDPipe) id: string) { return this.commands.clear(id); }
  @Post(':id/archive')
  archive(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = z
      .object({ archived: z.boolean(), expectedRevision: z.number().int().nonnegative() })
      .strict()
      .parse(body);
    return this.projects.archive(id, input.archived, input.expectedRevision);
  }
  @Delete(':id')
  remove(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = z
      .object({ expectedRevision: z.number().int().nonnegative() })
      .strict()
      .parse(body);
    return this.projects.remove(id, input.expectedRevision);
  }
  @Post(':id/duplicate')
  duplicate(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = z
      .object({ requestId: z.string().uuid(), expectedRevision: z.number().int().nonnegative() })
      .strict()
      .parse(body);
    return this.projects.duplicate(id, input.requestId, input.expectedRevision);
  }
  @Post(':id/runs')
  @HttpCode(202)
  run(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.projects.start(id, runHtmlProjectSchema.parse(body));
  }
  @Get(':id/conversation')
  conversation(@Param('id', ParseUUIDPipe) id: string) {
    return this.conversations.get(id);
  }
  @Post(':id/conversation/stop')
  @HttpCode(200)
  stopConversation(@Param('id', ParseUUIDPipe) id: string) {
    return this.conversations.stop(id);
  }
  @Post(':id/questions')
  @HttpCode(200)
  ask(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    return this.conversations.ask(id, askHtmlSceneSchema.parse(body));
  }
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.projects.cancel(id);
  }
  @Post(':id/undo')
  @HttpCode(200)
  undo(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown) {
    const input = z
      .object({ expectedRevision: z.number().int().nonnegative(), operationId: z.string().uuid() })
      .strict()
      .parse(body);
    return this.projects.undo(id, input.expectedRevision, input.operationId);
  }
}

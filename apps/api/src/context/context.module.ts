import { Module } from '@nestjs/common';
import { CONTEXT_RETRIEVERS, ContextService, type ContextRetriever } from './context.service.js';

@Module({
  providers: [
    { provide: CONTEXT_RETRIEVERS, useValue: [] satisfies ContextRetriever[] },
    { provide: ContextService, inject: [CONTEXT_RETRIEVERS], useFactory: (retrievers: ContextRetriever[]) => new ContextService(retrievers) },
  ],
  exports: [ContextService],
})
export class ContextModule {}

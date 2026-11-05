import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { APP_CONFIG, allowedWebOrigins, type AppConfig } from './config.js';
import { AppModule } from './app.module.js';
import { ErrorFilter } from './common/error.filter.js';

export async function createApp() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  const config = app.get<AppConfig>(APP_CONFIG);
  const origins = allowedWebOrigins(config.WEB_ORIGIN, config.DESKTOP_CLIENT_ENABLED);
  app.use(helmet());
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Request-Id', randomUUID());
    if (
      ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) &&
      req.headers.origin &&
      !origins.includes(req.headers.origin)
    ) {
      res.status(403).json({ error: { code: 'ORIGIN_DENIED', message: '请求来源不允许' } });
      return;
    }
    next();
  });
  app.enableCors({ origin: origins, methods: ['GET', 'POST', 'PATCH', 'DELETE'] });
  app.use('/api/html-projects', json({ limit: '4mb' }));
  app.use(json({ limit: '200kb' }));
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
  await app.init();
  return app;
}

import { Catch, HttpException, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';

@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(ErrorFilter.name);
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status =
      error instanceof ZodError ? 400 : error instanceof HttpException ? error.getStatus() : 500;
    if (status === 500)
      this.logger.error(`请求 ${String(response.getHeader('X-Request-Id'))} 发生内部错误`);
    response.status(status).json({
      error: {
        code: error instanceof ZodError ? 'VALIDATION_ERROR' : `HTTP_${status}`,
        message:
          error instanceof ZodError
            ? error.issues.map((issue) => issue.message).join('；')
            : error instanceof HttpException
              ? error.message
              : '服务暂时不可用，请稍后重试',
      },
      requestId: response.getHeader('X-Request-Id'),
    });
  }
}

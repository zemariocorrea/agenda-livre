import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';

interface HttpExceptionBody {
  message?: string | string[];
  error?: string;
  statusCode?: number;
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest<Request>();
    const response = context.getResponse<Response>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : undefined;

    const detail = this.resolveDetail(exceptionResponse, status);
    const correlationId =
      typeof response.locals.correlationId === 'string'
        ? response.locals.correlationId
        : undefined;

    if (status >= 500) {
      const error = exception instanceof Error ? exception : new Error('Unknown error');
      console.error('Unhandled API error', {
        correlationId,
        method: request.method,
        path: request.originalUrl,
        errorName: error.name,
        errorMessage: error.message,
      });
    }

    response
      .status(status)
      .type('application/problem+json')
      .send({
        type: 'about:blank',
        title: this.titleFor(status),
        status,
        detail,
        instance: request.originalUrl,
        correlationId,
      });
  }

  private resolveDetail(exceptionResponse: unknown, status: number) {
    if (status >= 500) return 'O serviço encontrou um erro inesperado.';
    if (typeof exceptionResponse === 'string') return exceptionResponse;
    if (this.isHttpExceptionBody(exceptionResponse)) {
      const message = exceptionResponse.message;
      return Array.isArray(message) ? message.join('; ') : message ?? exceptionResponse.error ?? 'Requisição inválida.';
    }
    return 'Requisição inválida.';
  }

  private isHttpExceptionBody(value: unknown): value is HttpExceptionBody {
    return typeof value === 'object' && value !== null;
  }

  private titleFor(status: number) {
    const titles: Record<number, string> = {
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      409: 'Conflict',
      422: 'Unprocessable Entity',
      429: 'Too Many Requests',
      503: 'Service Unavailable',
    };
    return titles[status] ?? (status >= 500 ? 'Internal Server Error' : 'Request Error');
  }
}

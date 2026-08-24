import { UnprocessableEntityException, ValidationPipe } from "@nestjs/common";

export function createApiValidationPipe(): ValidationPipe {
  return new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    stopAtFirstError: false,
    validationError: { target: false, value: false },
    exceptionFactory: () => new UnprocessableEntityException(),
  });
}

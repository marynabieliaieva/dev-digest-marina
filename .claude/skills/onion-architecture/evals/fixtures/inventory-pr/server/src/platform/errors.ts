export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 400,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found') {
    super('not_found', message, 404);
  }
}

export class ValidationError extends AppError {
  constructor(message = 'Validation failed') {
    super('validation_error', message, 422);
  }
}

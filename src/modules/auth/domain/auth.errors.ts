// Domain-specific auth error types (extending base app errors)
// These are thin re-exports — actual business errors use AppError subclasses from common/errors

export { ArgumentInvalidException } from '@/common/errors/app-error';

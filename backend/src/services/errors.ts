/**
 * Errors a service raises for a caller's mistake, rather than a fault.
 *
 * Routes used to decide the status code by matching on message text
 * (`message.includes('not found')`), which meant a reworded message quietly
 * turned a 404 into a 500, and a genuine fault whose message happened to
 * contain the phrase turned into a 404. The class carries the intent instead.
 */

export class ServiceError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** The thing addressed does not exist, or the caller may not see that it does. */
export class NotFoundError extends ServiceError {
  constructor(message = 'Not found') {
    super(message, 404);
  }
}

/** The request itself is wrong: missing, contradictory or impossible input. */
export class ValidationError extends ServiceError {
  constructor(message: string) {
    super(message, 400);
  }
}

/** The request is well formed but conflicts with what is already there. */
export class ConflictError extends ServiceError {
  constructor(message: string) {
    super(message, 409);
  }
}

/** The caller is known but not allowed to do this. */
export class ForbiddenError extends ServiceError {
  constructor(message = 'Forbidden') {
    super(message, 403);
  }
}

/**
 * Status and message for an error on its way out of a route.
 *
 * Anything that is not a `ServiceError` is a fault: it becomes a 500 with the
 * caller-supplied fallback, so an internal message is never echoed back.
 */
export function errorResponse(error: unknown, fallback: string): { status: number; error: string } {
  if (error instanceof ServiceError) {
    return { status: error.status, error: error.message };
  }
  return { status: 500, error: fallback };
}

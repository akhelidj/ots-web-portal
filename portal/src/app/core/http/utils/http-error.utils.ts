import { HttpErrorResponse } from '@angular/common/http';

type ErrorPayloadObject = {
  message?: string | string[];
  error?: string;
  title?: string;
  details?: string | string[];
  errors?: Record<string, string | string[]>;
};

type ErrorPayload = string | string[] | ErrorPayloadObject | null | undefined;

function joinMessages(value: string | string[]): string | null {
  if (Array.isArray(value)) {
    const parts = value.map((item) => item.trim()).filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function extractRecordMessages(
  errors: Record<string, string | string[]>,
): string | null {
  const messages = Object.values(errors)
    .flatMap((value) => (Array.isArray(value) ? value : [value]))
    .map((value) => value.trim())
    .filter(Boolean);

  return messages.length > 0 ? messages.join(', ') : null;
}

export function extractBackendErrorMessage(
  error: unknown,
  fallback = 'Request failed.',
): string {
  if (!(error instanceof HttpErrorResponse)) {
    return error instanceof Error && error.message ? error.message : fallback;
  }

  if (typeof error.error === 'string') {
    const directMessage = error.error.trim();
    return directMessage.length > 0 ? directMessage : error.message || fallback;
  }

  const payload = error.error as ErrorPayload;
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const explicitMessage =
      (payload.message && joinMessages(payload.message)) ||
      (payload.details && joinMessages(payload.details)) ||
      (payload.error && joinMessages(payload.error)) ||
      (payload.title && joinMessages(payload.title)) ||
      (payload.errors && extractRecordMessages(payload.errors));

    if (explicitMessage) {
      return explicitMessage;
    }
  }

  if (error.status === 0) {
    return 'Unable to reach the server.';
  }

  return error.message || fallback;
}

export function withNormalizedHttpErrorMessage(
  error: HttpErrorResponse,
): HttpErrorResponse {
  const normalizedMessage = extractBackendErrorMessage(error, error.message);
  const mutableError = error as HttpErrorResponse & { message: string };
  mutableError.message = normalizedMessage;
  return mutableError;
}

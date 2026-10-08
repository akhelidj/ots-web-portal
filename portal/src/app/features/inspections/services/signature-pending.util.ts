import { HttpErrorResponse } from '@angular/common/http';

export interface PendingSigner {
  key: string;
  label: string;
  signer: 'CUSTOMER' | 'SUPERVISOR';
}

/** Blob.text() where available; FileReader for older engines. */
function blobText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

/**
 * The export endpoint answers 409 `{ code: 'SIGNATURE_PENDING', pending: [...] }` while a
 * required signature is missing. The export request uses `responseType: 'blob'`, so the error
 * body arrives as a Blob (or already-parsed JSON in tests): read either shape. Returns null for
 * any other error.
 */
export async function readSignaturePending(
  error: HttpErrorResponse,
): Promise<PendingSigner[] | null> {
  if (error.status !== 409) return null;

  let body: unknown = error.error;
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    try {
      body = JSON.parse(await blobText(body));
    } catch {
      return null;
    }
  }

  const parsed = body as { code?: string; pending?: unknown } | null;
  if (!parsed || parsed.code !== 'SIGNATURE_PENDING') return null;
  if (!Array.isArray(parsed.pending)) return [];
  return parsed.pending.filter(
    (p): p is PendingSigner =>
      !!p &&
      typeof (p as PendingSigner).key === 'string' &&
      typeof (p as PendingSigner).label === 'string',
  );
}

/** "Waiting for signature: Customer approval (customer), QA (supervisor)". */
export function describeSignaturePending(pending: PendingSigner[]): string {
  if (pending.length === 0) return 'A required signature is still missing.';
  const parts = pending.map(
    (p) =>
      `${p.label} (${p.signer === 'CUSTOMER' ? 'customer' : 'supervisor'})`,
  );
  return `Export blocked — waiting for signature: ${parts.join(', ')}.`;
}

import { SetMetadata } from '@nestjs/common';

export const ALLOW_WITHOUT_SIGNATURE_KEY = 'allowWithoutSignature';

/**
 * Exempts a route (or whole controller) from {@link SignatureRequiredGuard}: an
 * INSPECTOR with no registered signature may still call it. Reserved for the routes
 * that let them escape the gate (register a signature, change the password).
 */
export const AllowWithoutSignature = () =>
  SetMetadata(ALLOW_WITHOUT_SIGNATURE_KEY, true);

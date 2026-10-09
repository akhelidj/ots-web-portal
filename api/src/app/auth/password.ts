import * as bcrypt from 'bcrypt';

/** bcrypt work factor for every new password hash (OWASP: >= 10; 12 is the current sweet spot). */
export const PASSWORD_HASH_ROUNDS = 12;

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, PASSWORD_HASH_ROUNDS);
}

/** True when a stored hash was made with a weaker work factor than we now use. */
export function needsRehash(hash: string): boolean {
  try {
    return bcrypt.getRounds(hash) < PASSWORD_HASH_ROUNDS;
  } catch {
    return false;
  }
}

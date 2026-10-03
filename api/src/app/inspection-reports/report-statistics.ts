import { BadRequestException } from '@nestjs/common';

/** One free-entry statistic: a label, a typed value, and optional serials (by serial text). */
export interface ReportStatistic {
  id: string;
  label: string;
  value: string;
  serials: string[];
}

export const MAX_STATISTICS = 50;
export const MAX_STAT_SERIALS = 2000;
const MAX_ID = 64;
const MAX_LABEL = 80;
const MAX_VALUE = 60;
const MAX_SERIAL = 120;

/**
 * Normalise an incoming `statistics` payload into the stored shape. Total over the
 * untrusted input: anything not an array of well-formed rows is a 400. Labels/values are
 * trimmed, a numeric value is stringified, serials are trimmed and de-duplicated (order
 * kept). Serial existence is deliberately NOT checked — an offline edit may reference a
 * serial whose own sync lands in the same drain, and a rejected write would strand the
 * outbox item; the portal resolves serials at render time.
 */
export function normalizeStatistics(input: unknown): ReportStatistic[] {
  if (!Array.isArray(input)) {
    throw new BadRequestException('statistics must be an array.');
  }
  if (input.length > MAX_STATISTICS) {
    throw new BadRequestException(
      `At most ${MAX_STATISTICS} statistics are allowed.`,
    );
  }
  const seenIds = new Set<string>();
  return input.map((raw, i) => {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new BadRequestException(`statistics[${i}] must be an object.`);
    }
    const r = raw as Record<string, unknown>;
    const id = typeof r.id === 'string' ? r.id.trim() : '';
    if (!id || id.length > MAX_ID || seenIds.has(id)) {
      throw new BadRequestException(
        `statistics[${i}].id must be a unique non-empty string.`,
      );
    }
    seenIds.add(id);
    const label = typeof r.label === 'string' ? r.label.trim() : '';
    if (!label || label.length > MAX_LABEL) {
      throw new BadRequestException(
        `statistics[${i}].label is required (max ${MAX_LABEL} chars).`,
      );
    }
    const rawValue =
      typeof r.value === 'number' && Number.isFinite(r.value)
        ? String(r.value)
        : r.value;
    const value = typeof rawValue === 'string' ? rawValue.trim() : '';
    if (!value || value.length > MAX_VALUE) {
      throw new BadRequestException(
        `statistics[${i}].value is required (max ${MAX_VALUE} chars).`,
      );
    }
    let serials: string[] = [];
    if (r.serials !== undefined && r.serials !== null) {
      if (
        !Array.isArray(r.serials) ||
        r.serials.length > MAX_STAT_SERIALS ||
        !r.serials.every((s) => typeof s === 'string')
      ) {
        throw new BadRequestException(
          `statistics[${i}].serials must be an array of strings.`,
        );
      }
      const cleaned = (r.serials as string[]).map((s) => s.trim());
      if (cleaned.some((s) => !s || s.length > MAX_SERIAL)) {
        throw new BadRequestException(
          `statistics[${i}].serials contains an invalid serial.`,
        );
      }
      serials = [...new Set(cleaned)];
    }
    return { id, label, value, serials };
  });
}

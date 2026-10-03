import { InspectionReportStatus as S, UserRole } from '@prisma/client';
import { INSPECTION_REPORT_TRANSITIONS } from './workflow.policy';

describe('INSPECTION_REPORT_TRANSITIONS — supervisor', () => {
  const sup = INSPECTION_REPORT_TRANSITIONS[UserRole.SUPERVISOR];

  it.each([
    [S.DRAFT, S.ON_HOLD],
    [S.RECEIVED, S.READY_FOR_CLEANING],
    [S.READY_FOR_CLEANING, S.READY_FOR_INSPECTION],
    [S.READY_FOR_INSPECTION, S.IN_INSPECTION],
    [S.IN_INSPECTION, S.ON_HOLD],
    [S.PENDING_APPROVAL, S.APPROVED],
  ])('may move %s -> %s', (from, to) => {
    expect(sup[from]).toContain(to);
  });

  it('cannot do the admin-only steps (intake, reopen)', () => {
    expect(sup[S.DRAFT]).not.toContain(S.RECEIVED);
    expect(sup[S.APPROVED]).not.toContain(S.IN_INSPECTION);
    expect(sup[S.CLOSED]).toBeUndefined();
  });
});

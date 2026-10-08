import {
  ChildReportStatus as C,
  InspectionReportStatus as S,
  UserRole,
} from '@prisma/client';
import {
  CHILD_REPORT_TRANSITIONS,
  INSPECTION_REPORT_TRANSITIONS,
} from './workflow.policy';

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

  it('can also do the former admin-only steps (intake, force-close, reopen)', () => {
    expect(sup[S.DRAFT]).toContain(S.RECEIVED);
    expect(sup[S.DRAFT]).toContain(S.CLOSED);
    expect(sup[S.IN_INSPECTION]).toContain(S.CLOSED);
    expect(sup[S.APPROVED]).toContain(S.IN_INSPECTION);
    expect(sup[S.CLOSED]).toEqual(
      expect.arrayContaining([S.APPROVED, S.IN_INSPECTION]),
    );
  });

  it('has exactly the admin matrix on a report', () => {
    expect(sup).toEqual(INSPECTION_REPORT_TRANSITIONS[UserRole.ADMIN]);
  });
});

describe('CHILD_REPORT_TRANSITIONS — supervisor', () => {
  it('has exactly the admin matrix on a child report', () => {
    const sup = CHILD_REPORT_TRANSITIONS[UserRole.SUPERVISOR];
    expect(sup).toEqual(CHILD_REPORT_TRANSITIONS[UserRole.ADMIN]);
    expect(sup[C.DRAFT]).toContain(C.IN_INSPECTION);
    expect(sup[C.APPROVED]).toContain(C.IN_INSPECTION);
  });
});

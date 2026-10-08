import { PrismaService } from '../prisma/prisma.service';

/**
 * Actions that count as "working on the report's inspection", as recorded in the audit
 * log: inspecting/renaming/adding/removing serials, editing the report itself (header
 * fields, statistics, comment) and adding an attachment. Status transitions are NOT
 * actions — they are workflow moves, so a reopen alone never changes the inspector.
 */
const INSPECTION_ACTIONS = [
  { entity: 'SerialNumber', action: { in: ['UPDATE', 'CREATE_BULK', 'DELETE'] } },
  { entity: 'InspectionReport', action: 'UPDATE' },
  { entity: 'Attachment', action: 'CREATE' },
];

/** Upper bound on audit rows scanned; the newest in-phase action is nearly always first. */
const SCAN_LIMIT = 500;

type Window = { start: Date; end: Date | null };

/** The report's IN_INSPECTION phases, from its transition logs (ascending). */
function inspectionWindows(
  logs: { fromStatus: string; toStatus: string; timestamp: Date }[],
): Window[] {
  const windows: Window[] = [];
  let open: Date | null = null;
  for (const log of logs) {
    if (log.toStatus === 'IN_INSPECTION' && open === null) {
      open = log.timestamp;
    } else if (
      log.fromStatus === 'IN_INSPECTION' &&
      log.toStatus !== 'IN_INSPECTION' &&
      open !== null
    ) {
      windows.push({ start: open, end: log.timestamp });
      open = null;
    }
  }
  if (open !== null) windows.push({ start: open, end: null });
  return windows;
}

/**
 * The report's inspector: the user behind the MOST RECENT action taken on the report
 * while it was IN_INSPECTION — any phase of it, reopened or not. A reopen that has had
 * no new work keeps the inspector from before the revision; new work takes over.
 *
 * Returns null when no such action was ever recorded (callers fall back to who started
 * the inspection).
 */
export async function findLastInspectorUserId(
  prisma: Pick<PrismaService, 'auditLog' | 'inspectionReportTransitionLog'>,
  tenantId: string,
  reportId: string,
  /** Only consider history up to this instant (a revision's "as of" time). */
  until?: Date,
): Promise<string | null> {
  const logs = await prisma.inspectionReportTransitionLog.findMany({
    where: {
      inspectionReportId: reportId,
      ...(until ? { timestamp: { lte: until } } : {}),
    },
    orderBy: { timestamp: 'asc' },
    select: { fromStatus: true, toStatus: true, timestamp: true },
  });
  const windows = inspectionWindows(logs);
  if (windows.length === 0) return null;

  const actions = await prisma.auditLog.findMany({
    where: {
      tenantId,
      inspectionReportId: reportId,
      userId: { not: null },
      OR: INSPECTION_ACTIONS,
      ...(until ? { timestamp: { lte: until } } : {}),
    },
    orderBy: { timestamp: 'desc' },
    take: SCAN_LIMIT,
    select: { userId: true, timestamp: true },
  });

  for (const a of actions) {
    const t = a.timestamp.getTime();
    if (
      windows.some(
        (w) => t >= w.start.getTime() && (w.end === null || t <= w.end.getTime()),
      )
    ) {
      return a.userId;
    }
  }
  return null;
}

/**
 * The inspector for display/export: {@link findLastInspectorUserId}, falling back to
 * whoever first started the inspection (first move into IN_INSPECTION) when no action
 * was ever recorded. Resolved to a name server-side, so every role sees the same value
 * (the portal's local user cache is admin-only).
 */
export async function resolveInspector(
  prisma: Pick<
    PrismaService,
    'auditLog' | 'inspectionReportTransitionLog' | 'user'
  >,
  tenantId: string,
  reportId: string,
  until?: Date,
): Promise<{ userId: string | null; name: string | null }> {
  let userId = await findLastInspectorUserId(prisma, tenantId, reportId, until);
  if (!userId) {
    const starter = await prisma.inspectionReportTransitionLog.findFirst({
      where: {
        inspectionReportId: reportId,
        toStatus: 'IN_INSPECTION',
        userId: { not: null },
        ...(until ? { timestamp: { lte: until } } : {}),
      },
      orderBy: { timestamp: 'asc' },
      select: { userId: true },
    });
    userId = starter?.userId ?? null;
  }
  if (!userId) return { userId: null, name: null };
  const user = await prisma.user.findFirst({
    where: { id: userId, tenantId },
    select: { name: true, email: true },
  });
  return { userId, name: user?.name || user?.email || null };
}

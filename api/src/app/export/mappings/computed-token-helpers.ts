import { Snapshot } from '../../common/inspection-data.types';

/**
 * Bespoke "computed" export values — derivations that are inherently engine code
 * (date formatting, transition-log traversal), not part of a template
 * definition's generalizable token vocabulary (Phase A established `computed` as
 * an engine-side allow-list).
 *
 * These are SHARED by both the legacy drill-pipe token computation
 * (`legacyGlobalTokens`) and the definition-driven engine
 * (`export-engine.ts` COMPUTED registry), so the two paths cannot diverge on the
 * derivation itself — only on the WIRING (which token maps to which computed
 * name), which the equivalence + mutation-guard specs pin. Moved VERBATIM from
 * the pre-B2 `mapDrillPipeReportV1`.
 */

/** `{{reportDate}}` — updatedAt (else createdAt) via toLocaleDateString, else 'N/A'. */
export function deriveReportDate(h: Snapshot['header']): string {
  return h.updatedAt
    ? new Date(h.updatedAt).toLocaleDateString()
    : h.createdAt
      ? new Date(h.createdAt).toLocaleDateString()
      : 'N/A';
}

/**
 * `{{inspectedBy}}` / `{{approvedBy}}` — seeded from the injected header names,
 * then (approved-by) overridden from the transition log: latest APPROVED/CLOSED
 * actor, resolved against snapshot.users. Inspected-by is taken from the injected
 * header name when the export service resolved one (last actor during IN_INSPECTION);
 * only when none was resolved does it fall back to the earliest
 * IN_INSPECTION/PENDING_APPROVAL actor from the transition log.
 */
export function deriveActors(snapshot: Snapshot): {
  inspectedBy: string;
  approvedBy: string;
} {
  const h = snapshot.header;
  let inspectedByName = h.inspectedByName || 'N/A';
  let approvedByName = h.approvedByName || 'N/A';
  const transitionLogs = snapshot.transitionLogs || [];
  if (Array.isArray(transitionLogs) && transitionLogs.length > 0) {
    const asc = [...transitionLogs].sort(
      (a, b) =>
        new Date(a.timestamp ?? 0).getTime() -
        new Date(b.timestamp ?? 0).getTime(),
    );
    const inspectLog = asc.find(
      (l) =>
        l.toStatus === 'IN_INSPECTION' || l.toStatus === 'PENDING_APPROVAL',
    );
    const inspectorResolved = !!h.inspectedByName && h.inspectedByName !== 'N/A';
    if (!inspectorResolved && inspectLog?.userId) {
      const u = (snapshot.users || []).find((u) => u.id === inspectLog.userId);
      if (u) inspectedByName = u.name || u.email;
    }
    const approveLog = [...asc]
      .reverse()
      .find((l) => l.toStatus === 'APPROVED' || l.toStatus === 'CLOSED');
    if (approveLog?.userId) {
      const u = (snapshot.users || []).find((u) => u.id === approveLog.userId);
      if (u) approvedByName = u.name || u.email;
    }
  }
  return { inspectedBy: inspectedByName, approvedBy: approvedByName };
}

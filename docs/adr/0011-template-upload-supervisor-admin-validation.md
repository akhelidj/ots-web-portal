# ADR-0011 — Supervisors own the template upload workflow, behind an admin validation gate

**Status:** Accepted (standing decision)

## Context

Template authoring — uploading a workbook version and defining its form — was ADMIN-only.
In practice the people who know what a report must contain are supervisors, not admins, so
every template change queued behind an admin, who was transcribing someone else's intent.
Widening the role is the obvious fix and the wrong one on its own: a template version is
consumed by every report created against it, so an unreviewed upload is a production change
with no second pair of eyes.

The existing RBAC gives the mechanism for free: `RolesGuard` resolves roles with
`reflector.getAllAndOverride(ROLES_KEY, [handler, class])`, so a method-level `@Roles`
**overrides** the class-level one. A controller can therefore be opened to SUPERVISOR
wholesale while individual endpoints re-narrow to ADMIN.

## Decision

**SUPERVISOR gets the whole upload workflow** — `POST /templates`, the token/definition
reads, `PUT :id/definition`, and the definition-revision endpoints — by widening
`TemplateController`'s class-level `@Roles` to `(ADMIN, SUPERVISOR)`. The portal mounts the
same two components under `/supervisor/templates` and `/supervisor/templates/:id/define`.

**Every upload passes an admin validation gate before it can be used.** `Template` carries
a new `approvalStatus` (`PENDING_APPROVAL` | `APPROVED` | `REJECTED`) plus
`approvedById` / `approvedAt` / `rejectionReason`. The gate is decided by the **uploader's
role, read off the JWT, never from the request body**: an ADMIN upload is born `APPROVED`
(an admin validating their own upload is no-op ceremony); a SUPERVISOR upload lands
`PENDING_APPROVAL`.

Three deliberate choices inside that:

1. **The gate is on _usability for reports_, not on uploading or defining.** A supervisor
   uploads **and** defines freely while pending; approval releases the finished thing. The
   alternative — gating the upload itself — would have an admin approving a workbook whose
   form nobody has seen yet, which is the wrong thing to review.
2. **The handover is deferred.** A version that lands `PENDING_APPROVAL` does **not**
   deprecate the previous ACTIVE version; `approveTemplate` performs that step when the gate
   clears (shared `retirePreviousActive` helper, `excludeId` = the version being approved).
   Without this, an unvalidated upload would take the live form out of service on the spot —
   the single worst failure this feature could have introduced.
3. **Rejection keeps the row**, with a required reason surfaced to the supervisor on the
   list. Terminal: a rejected version can never become available, and retry is a **new**
   version upload, never an in-place edit. The alternative — deleting the rejected row — is
   cheaper but destroys the audit trail of what was refused and why.

`approve`, `reject`, and `deprecate` re-narrow to `@Roles(ADMIN)`. Deprecate stays
admin-only on purpose: it retires a template ops are actively using.

**The gate is enforced as a server-side WHERE in every consumption path**, not as a client
filter: `getAvailableTemplates` (the picker) and `createReport` (the live create path) both
AND `approvalStatus: APPROVED` alongside ACTIVE + defined, and the unwired multi-template
seam `InspectionReportWorkflowService.create` (see [ADR-0009](0009-single-template-hardcode-seam.md))
got the same clause so wiring it later cannot reintroduce the hole. A caller who posts a
pending `templateKey` straight at the create endpoint is refused.

The column defaults to `APPROVED`, which **is** the backfill — every pre-existing row was
admin-uploaded, so nothing becomes retroactively unusable on migration.

## Consequences

Template authoring moves to the people who own the content, without giving up review.
Reviewing a _finished, defined_ version is a better review than approving a bare workbook.
The gate is orthogonal to `status` (lifecycle) and `definitionJson` (form shape), so it
composes with both rather than overloading either.

Costs and things to know:

- **A third axis on `Template`.** "Usable" is now `ACTIVE && definitionJson != null &&
approvalStatus == APPROVED`. Any new consumption path must AND in all three; miss the
  third and you have a bypass. The two live paths and the unwired seam are done.
- **A pending version and the live version coexist as ACTIVE.** The deferred handover is
  what makes that safe, but it means `status: ACTIVE` alone no longer implies "in service."
- **No queue or notification.** An admin discovers pending uploads by looking at the
  templates list. If uploads outpace attention, versions sit pending and nobody is told.
- **Approve is idempotent, reject is terminal** — asymmetric by design. Re-approving an
  approved version deliberately does nothing rather than running the handover twice.
- **Supervisors can still not deprecate**, so a supervisor can bring a new version in (via
  admin approval) but cannot retire one directly.
- Per [ADR-0008](0008-no-shared-dto-package.md) the portal's `TemplateApprovalStatus` and
  the four new `AdminTemplateItem` fields are a **hand-mirrored** copy of the API contract;
  they drift silently if the server shape changes.

Anchors: `api/prisma/schema.prisma` (`model Template`, `enum TemplateApprovalStatus`);
`api/src/app/template/template.service.ts` (`createTemplate`, `approveTemplate`,
`rejectTemplate`, `retirePreviousActive`); `api/src/app/template/template.controller.ts`;
`api/src/app/inspection-reports/inspection-reports.service.ts`
(`getAvailableTemplates`, `createReport`); contracts in
[`../api/template-endpoints.md`](../api/template-endpoints.md).

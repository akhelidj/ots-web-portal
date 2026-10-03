import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  AdminTemplateItem,
  AdminTemplatesService,
  isTemplateDefined,
} from '@portal/features/templates/services/admin-templates.service';
import { ConnectivityService } from '@portal/core/offline/services/connectivity.service';
import { UserPreferencesService } from '@portal/core/services/user-preferences.service';
import { SessionService } from '@portal/core/auth/services/session.service';
import { APP_ROLES } from '@portal/core/constants/app.constants';
import { ConfirmService } from '@portal/shared/confirm/confirm.service';

@Component({
  selector: 'app-admin-templates',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './admin-templates.component.html',
})
export class AdminTemplatesComponent {
  public templatesService = inject(AdminTemplatesService);
  private confirmService = inject(ConfirmService);
  public connectivity = inject(ConnectivityService);
  public prefs = inject(UserPreferencesService);
  public isCompactMode = computed(() => this.prefs.preferences().compactMode);

  private session = inject(SessionService);

  public templates = this.templatesService.templates;
  public isOnline = this.connectivity.isOnline;

  /** Only an ADMIN validates uploads — a supervisor sees the gate state but not the
   *  Approve/Reject actions (validating your own upload would defeat the gate). */
  public readonly isAdmin = computed(
    () => this.session.profile()?.role === APP_ROLES.ADMIN,
  );

  // Form State
  public showUploadForm = false;
  public formTemplateKey = '';
  public formChangeNote = '';
  public formFile: File | null = null;
  public isSubmitting = false;
  public formError = '';

  /** The row action's word: a DEFINED template opens as a read-only recap → "View"; an
   *  undefined one opens the authoring wizard → "Define". Driven off the same
   *  `isTemplateDefined` predicate the Define page's read-only branch uses (single source of
   *  truth), so the label and the recap can't drift. */
  public actionLabel(tmpl: AdminTemplateItem): string {
    return isTemplateDefined(tmpl.definitionJson) ? 'View' : 'Define';
  }

  /** The validation badge's word. 'PENDING_APPROVAL' reads as "Pending" in the cell — the
   *  full state is carried by the colour and the adjacent actions. */
  public approvalLabel(tmpl: AdminTemplateItem): string {
    switch (tmpl.approvalStatus) {
      case 'APPROVED':
        return 'Approved';
      case 'PENDING_APPROVAL':
        return 'Pending';
      case 'REJECTED':
        return 'Rejected';
    }
  }

  public async refreshTemplates() {
    this.formError = '';
    try {
      await this.templatesService.fetchAll();
    } catch {
      this.formError = 'Failed to load templates. Are you online?';
    }
  }

  public onFileSelected(event: Event) {
    const el = event.target as HTMLInputElement;
    if (el.files && el.files.length > 0) {
      this.formFile = el.files[0] ?? null;
    } else {
      this.formFile = null;
    }
  }

  public async submitUpload() {
    this.formError = '';
    if (
      !this.formTemplateKey.trim() ||
      !this.formChangeNote.trim() ||
      !this.formFile
    ) {
      this.formError =
        'Please provide a template key, change note, and select an Excel file.';
      return;
    }

    this.isSubmitting = true;
    try {
      await this.templatesService.createTemplate(
        this.formTemplateKey.trim().toUpperCase(),
        this.formChangeNote.trim(),
        this.formFile,
      );

      this.showUploadForm = false;
      this.formTemplateKey = '';
      this.formChangeNote = '';
      this.formFile = null;
    } catch (error: unknown) {
      const e = error as { error?: { message?: string }; message?: string };
      this.formError =
        e?.error?.message ||
        e?.message ||
        'Failed to upload template. TemplateKey/Version combo might already exist.';
    } finally {
      this.isSubmitting = false;
    }
  }

  /** Approve the pending version — it becomes usable for reports and retires the one it
   *  replaces, so the confirmation names that consequence. */
  public async approveTemplate(tmpl: AdminTemplateItem) {
    const ok = await this.confirmService.confirm({
      title: `Approve ${tmpl.templateKey} v${tmpl.templateVersion}?`,
      message:
        'It becomes available for new reports and replaces the current active version.',
      confirmLabel: 'Approve',
    });
    if (!ok) return;

    this.formError = '';
    try {
      await this.templatesService.approveTemplate(tmpl.id);
    } catch (error: unknown) {
      this.formError = this.errorMessage(error, 'Failed to approve template.');
    }
  }

  /** Reject the pending version with a required reason the uploader sees on this list.
   *  Terminal — the supervisor retries by uploading a new version. */
  public async rejectTemplate(tmpl: AdminTemplateItem) {
    const reason = await this.confirmService.confirmWithReason({
      title: `Reject ${tmpl.templateKey} v${tmpl.templateVersion}?`,
      message:
        'The uploader sees your reason on their template list and must upload a new version to retry.',
      confirmLabel: 'Reject',
      tone: 'danger',
      reason: {
        label: 'Reason (required)',
        placeholder: 'What needs to change?',
      },
    });
    // Cancelled — nothing to send; the dialog already requires a reason.
    if (reason == null) return;

    this.formError = '';
    try {
      await this.templatesService.rejectTemplate(tmpl.id, reason);
    } catch (error: unknown) {
      this.formError = this.errorMessage(error, 'Failed to reject template.');
    }
  }

  private errorMessage(error: unknown, fallback: string): string {
    const e = error as { error?: { message?: string }; message?: string };
    return e?.error?.message || e?.message || fallback;
  }

  /** Remove a template that has not been defined yet — the undo for a wrong upload. */
  public async deleteTemplate(tmpl: AdminTemplateItem) {
    const ok = await this.confirmService.confirm({
      title: `Delete ${tmpl.templateKey} v${tmpl.templateVersion}?`,
      message:
        'This permanently removes the uploaded file and cannot be undone.',
      confirmLabel: 'Delete',
      tone: 'danger',
    });
    if (!ok) return;

    this.formError = '';
    try {
      await this.templatesService.deleteTemplate(tmpl.id);
    } catch (error: unknown) {
      this.formError = this.errorMessage(error, 'Failed to delete template.');
    }
  }

  public async deprecateTemplate(id: string) {
    const ok = await this.confirmService.confirm({
      title: 'Deprecate this template version?',
      message: 'New reports cannot be opened with a deprecated template.',
      confirmLabel: 'Deprecate',
      tone: 'danger',
    });
    if (!ok) return;

    try {
      await this.templatesService.deprecateTemplate(id);
    } catch (error: unknown) {
      const e = error as { error?: { message?: string }; message?: string };
      this.formError =
        e?.error?.message || e?.message || 'Failed to deprecate template.';
    }
  }
}

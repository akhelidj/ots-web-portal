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

@Component({
  selector: 'app-admin-templates',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './admin-templates.component.html',
})
export class AdminTemplatesComponent {
  public templatesService = inject(AdminTemplatesService);
  public connectivity = inject(ConnectivityService);
  public prefs = inject(UserPreferencesService);
  public isCompactMode = computed(() => this.prefs.preferences().compactMode);

  public templates = this.templatesService.templates;
  public isOnline = this.connectivity.isOnline;

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

  public async deprecateTemplate(id: string) {
    if (
      !confirm(
        'Are you sure you want to deprecate this template version? New reports cannot be opened with a deprecated template.',
      )
    )
      return;

    try {
      await this.templatesService.deprecateTemplate(id);
    } catch (error: unknown) {
      const e = error as { error?: { message?: string }; message?: string };
      this.formError =
        e?.error?.message || e?.message || 'Failed to deprecate template.';
    }
  }
}

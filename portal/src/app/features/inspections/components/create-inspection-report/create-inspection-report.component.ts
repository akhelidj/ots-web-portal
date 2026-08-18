import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import {
  AvailableTemplate,
  InspectionReportsService,
} from '@portal/features/inspections/services/inspection-reports.service';
import { CustomerLocalRepo } from '@portal/core/offline/repos/customer-local.repo';
import { LocalCustomer } from '@portal/core/offline/models/types';

@Component({
  selector: 'app-create-inspection-report',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './create-inspection-report.component.html',
})
export class CreateInspectionReportComponent {
  private irService = inject(InspectionReportsService);
  private customerRepo = inject(CustomerLocalRepo);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  public customers = signal<LocalCustomer[]>([]);

  // Zoneless: the fetched template list is set AFTER an async GET, so it MUST be a
  // signal or the <select> never re-renders when the load settles (the describe-screen
  // stuck-render bug taught us plain fields don't schedule CD). The current selection
  // (`formTemplateKey`) stays a plain [(ngModel)] field — it changes via DOM events,
  // which already notify the zoneless scheduler.
  public availableTemplates = signal<AvailableTemplate[]>([]);
  public templatesError = signal('');

  constructor() {
    this.loadCustomers();
    this.customerRepo.changes$.subscribe(() => this.loadCustomers());
    this.loadTemplates();
  }

  private async loadCustomers() {
    const list = await this.customerRepo.list();
    this.customers.set(list);
  }

  private async loadTemplates() {
    this.templatesError.set('');
    try {
      this.availableTemplates.set(await this.irService.getAvailableTemplates());
    } catch {
      this.availableTemplates.set([]);
      this.templatesError.set(
        'Could not load templates. You must be online to create a report.',
      );
    }
  }

  public formCustomer = '';
  public formPoNumber = '';
  // No default: the user must pick a template from the fetched, defined-only list.
  public formTemplateKey = '';
  public formError = '';

  public async onSubmit() {
    this.formError = '';

    if (!this.formCustomer || !this.formPoNumber || !this.formTemplateKey) {
      this.formError = 'Customer, PO Number and Template Key are required.';
      return;
    }

    try {
      await this.irService.createReport({
        customerId: this.formCustomer,
        poNumber: this.formPoNumber,
        templateKey: this.formTemplateKey,
      });
      const segment = this.router.url.split('/');
      segment.pop();
      this.router.navigate(segment);
    } catch (error) {
      const e = error as Error;
      this.formError = e.message || 'Failed to create report.';
    }
  }
}

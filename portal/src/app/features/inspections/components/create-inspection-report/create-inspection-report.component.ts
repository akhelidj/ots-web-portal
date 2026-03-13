import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule, ActivatedRoute } from '@angular/router';
import { InspectionReportsService } from '@portal/features/inspections/services/inspection-reports.service';
import { CustomerLocalRepo } from '@portal/core/offline/repos/customer-local.repo';
import { LocalCustomer } from '@portal/core/offline/models/types';
import { TEMPLATE_KEYS } from '@portal/core/constants/app.constants';

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

  constructor() {
    this.loadCustomers();
    this.customerRepo.changes$.subscribe(() => this.loadCustomers());
  }

  private async loadCustomers() {
    const list = await this.customerRepo.list();
    this.customers.set(list);
  }

  public formCustomer = '';
  public formPoNumber = '';
  public formTemplateKey = TEMPLATE_KEYS.DRILL_PIPE_REPORT; // Hardcoded requirement for now
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

import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { InspectionReportsService } from './inspection-reports.service';
import { CustomerLocalRepo } from '../core/offline/customer-local.repo';

@Component({
  selector: 'app-create-inspection-report',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterModule],
  templateUrl: './create-inspection-report.component.html'
})
export class CreateInspectionReportComponent {
  private irService = inject(InspectionReportsService);
  private customerRepo = inject(CustomerLocalRepo);
  private router = inject(Router);

  private customersSubj = new BehaviorSubject<any[]>([]);
  public customers$ = this.customersSubj.asObservable();

  constructor() {
    this.loadCustomers();
    this.customerRepo.changes$.subscribe(() => this.loadCustomers());
  }

  private async loadCustomers() {
    const list = await this.customerRepo.list();
    this.customersSubj.next(list);
  }

  public formCustomer: string = '';
  public formPoNumber: string = '';
  public formTemplateKey: string = 'DRILL_PIPE_REPORT'; // Hardcoded requirement for now
  public formError: string = '';

  public async onSubmit() {
    this.formError = '';
    
    if (!this.formPoNumber || !this.formTemplateKey) {
      this.formError = 'PO Number and Template Key are required.';
      return;
    }

    try {
      await this.irService.createOffline({
        customerId: this.formCustomer,
        poNumber: this.formPoNumber,
        templateKey: this.formTemplateKey
      });
      this.router.navigate(['/inspector/reports']);
    } catch (e: any) {
      this.formError = e.message || 'Failed to create report.';
    }
  }
}

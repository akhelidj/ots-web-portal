import { IsString, IsNotEmpty } from 'class-validator';

export class CreateInspectionReportDto {
  @IsString()
  @IsNotEmpty()
  customerId: string;

  @IsString()
  @IsNotEmpty()
  poNumber: string;

  /**
   * The template the report is created against. The portal picker sends the
   * templateKey of a defined+active template (from GET /inspection-reports/
   * available-templates); createReport resolves the newest ACTIVE version of this key
   * and binds the report to it. Required — the global ValidationPipe (whitelist:true)
   * strips anything not declared here, so this field is what lets the key reach the
   * service at all. Multi-template: no longer hardcoded to DRILL_PIPE_REPORT.
   */
  @IsString()
  @IsNotEmpty()
  templateKey: string;

  constructor(customerId: string, poNumber: string, templateKey: string) {
    this.customerId = customerId;
    this.poNumber = poNumber;
    this.templateKey = templateKey;
  }
}

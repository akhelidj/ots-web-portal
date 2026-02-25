import { IsString, IsNotEmpty } from 'class-validator';

export class CreateInspectionReportDto {
  @IsString()
  @IsNotEmpty()
  customerId: string;

  @IsString()
  @IsNotEmpty()
  poNumber: string;
}

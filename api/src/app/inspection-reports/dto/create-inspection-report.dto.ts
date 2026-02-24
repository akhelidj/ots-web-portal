import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class CreateInspectionReportDto {
  @IsOptional()
  @IsString()
  customerId?: string;

  @IsString()
  @IsNotEmpty()
  poNumber: string;
}

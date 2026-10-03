import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Min,
} from 'class-validator';

export class CreateApprovalBatchDto {
  @IsArray()
  @IsUUID('4', { each: true })
  @IsNotEmpty()
  serialNumberIds: string[];

  @IsString()
  @IsOptional()
  notes?: string;

  @IsInt()
  @Min(1)
  reportVersion: number;

  @IsUUID('4')
  @IsOptional()
  childReportId?: string;

  constructor(serialNumberIds: string[], reportVersion: number) {
    this.serialNumberIds = serialNumberIds;
    this.reportVersion = reportVersion;
  }
}

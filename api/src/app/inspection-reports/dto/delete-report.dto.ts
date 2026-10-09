import { IsInt, IsOptional, IsString } from 'class-validator';

export class DeleteReportDto {
  @IsOptional()
  @IsInt()
  version?: number;

  @IsOptional()
  @IsString()
  reason?: string;
}

import { IsArray, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class ApproveBatchDto {
  @IsInt()
  @Min(1)
  batchVersion: number;

  @IsInt()
  @Min(1)
  reportVersion: number;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  serialNumberIds?: string[];

  constructor(batchVersion: number, reportVersion: number) {
    this.batchVersion = batchVersion;
    this.reportVersion = reportVersion;
  }
}

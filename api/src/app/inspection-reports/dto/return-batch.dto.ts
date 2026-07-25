import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export class ReturnBatchDto {
  @IsInt()
  @Min(1)
  batchVersion: number;

  @IsInt()
  @Min(1)
  reportVersion: number;

  @IsString()
  @IsNotEmpty()
  reason: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  serialNumberIds?: string[];
}

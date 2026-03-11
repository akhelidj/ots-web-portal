import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';

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
}

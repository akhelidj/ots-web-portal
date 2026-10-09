import { IsOptional, IsString } from 'class-validator';

/** A body carrying only an optional free-text reason (reject / delete / deprecate). */
export class ReasonDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

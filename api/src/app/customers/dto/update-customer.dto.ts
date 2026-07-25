import {
  IsString,
  IsOptional,
  IsEmail,
  IsNumber,
  IsBoolean,
  IsNotEmpty,
  ValidateIf,
} from 'class-validator';

export class UpdateCustomerDto {
  @IsNumber()
  version: number;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  code?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  addressLine1?: string;

  @IsString()
  @IsOptional()
  addressLine2?: string;

  @IsString()
  @IsOptional()
  city?: string;

  @IsString()
  @IsOptional()
  country?: string;
}

export class UpdateCustomerActiveDto {
  @IsBoolean()
  isActive: boolean;

  @IsNumber()
  version: number;

  @ValidateIf((o) => o.isActive === false)
  @IsNotEmpty({ message: 'reason is required when deactivating' })
  @IsString()
  @IsOptional()
  reason?: string;
}

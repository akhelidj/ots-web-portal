import { Type } from 'class-transformer';
import { IsArray, IsString, ValidateNested } from 'class-validator';

export class SerialNumberItemDto {
  @IsString()
  clientRef!: string;

  // Emptiness / duplicates are domain rules answered by the service with specific messages.
  @IsString()
  serialNumber!: string;
}

export class CreateSerialNumbersDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SerialNumberItemDto)
  items!: SerialNumberItemDto[];
}

import { IsInt, IsObject, IsOptional, IsString } from 'class-validator';
import { InspectionData } from '../../common/inspection-data.types';

export class UpdateSerialNumberDto {
  // Presence is enforced by the controller ("version is required") to keep its message.
  @IsOptional()
  @IsInt()
  version!: number;

  @IsOptional()
  @IsString()
  serialNumber?: string;

  // Free-form, template-defined shape: only the container type is checked here.
  @IsOptional()
  @IsObject()
  inspectionData?: InspectionData;
}

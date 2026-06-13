import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export class VitalsWindowDto {
  @ApiProperty()
  @IsString()
  ts!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  heartRate?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  respiratoryRate?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  spo2?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  systolicBp?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsNumber()
  temperatureC?: number;
}

export class SepsisPredictDto {
  @ApiProperty()
  @IsString()
  patient_id!: string;

  @ApiProperty({ type: [VitalsWindowDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VitalsWindowDto)
  vitals_window!: VitalsWindowDto[];

  @ApiProperty({ type: Object, description: 'Lab name → value map' })
  @IsObject()
  labs!: Record<string, number>;
}

export class ReadmissionPredictDto {
  @ApiProperty()
  @IsString()
  patient_id!: string;

  @ApiProperty({ type: [VitalsWindowDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => VitalsWindowDto)
  vitals_window!: VitalsWindowDto[];

  @ApiProperty({ type: Object, description: 'Lab name → value map' })
  @IsObject()
  labs!: Record<string, number>;
}

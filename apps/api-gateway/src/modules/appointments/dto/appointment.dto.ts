import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { AppointmentStatus } from '../entities/appointment.entity';

const STATUSES: AppointmentStatus[] = [
  'booked',
  'arrived',
  'fulfilled',
  'cancelled',
  'noshow',
];

export class CreateAppointmentDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  patientId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  practitionerId!: string;

  @ApiProperty({ format: 'date-time' })
  @IsDateString()
  start!: string;

  @ApiProperty({ format: 'date-time' })
  @IsDateString()
  end!: string;

  @ApiPropertyOptional({ maxLength: 512 })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  reason?: string;
}

export class UpdateAppointmentDto extends PartialType(CreateAppointmentDto) {
  @ApiPropertyOptional({ enum: STATUSES })
  @IsOptional()
  @IsEnum(STATUSES)
  status?: AppointmentStatus;
}

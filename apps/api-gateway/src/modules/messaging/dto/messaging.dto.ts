import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateThreadDto {
  @ApiProperty({ maxLength: 256 })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  subject!: string;

  @ApiProperty({ description: 'FHIR Patient id the thread is about' })
  @IsString()
  @MinLength(1)
  patientId!: string;
}

export class CreateMessageDto {
  @ApiProperty({ description: 'Message body (never logged)', maxLength: 8000 })
  @IsString()
  @MinLength(1)
  @MaxLength(8000)
  body!: string;
}

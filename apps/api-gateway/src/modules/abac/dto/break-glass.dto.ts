import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class BreakGlassDto {
  @ApiProperty({ description: 'FHIR Patient id to gain emergency access to' })
  @IsString()
  @MinLength(1)
  patientId!: string;

  @ApiProperty({
    description:
      'Clinical justification (min 20 chars) — surfaced in compliance review',
    minLength: 20,
  })
  @IsString()
  @MinLength(20, {
    message: 'justification must be at least 20 characters',
  })
  justification!: string;
}

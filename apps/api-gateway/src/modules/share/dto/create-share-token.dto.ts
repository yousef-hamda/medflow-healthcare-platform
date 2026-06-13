import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

/** SMART scope or special scope grammar — keeps share grants well-formed. */
const SCOPE_RE =
  /^((patient|user|system)\/([A-Z][A-Za-z]*|\*)\.(read|write|\*|full)|launch|launch\/patient|openid|fhirUser|offline_access)$/;

export class CreateShareTokenDto {
  @ApiProperty({
    description: 'SMART scopes granted to the share client',
    example: ['patient/Observation.read', 'patient/Condition.read'],
    type: [String],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(32)
  @IsString({ each: true })
  @Matches(SCOPE_RE, { each: true, message: 'Invalid SMART scope' })
  scopes!: string[];

  @ApiProperty({ description: 'Lifetime in hours (max 72)', example: 24 })
  @IsInt()
  @Min(1)
  @Max(72)
  expiresInHours!: number;
}

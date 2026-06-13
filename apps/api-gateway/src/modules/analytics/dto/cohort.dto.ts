import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class AgeRangeDto {
  @ApiPropertyOptional({ minimum: 0, maximum: 120 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  min?: number;

  @ApiPropertyOptional({ minimum: 0, maximum: 120 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(120)
  max?: number;
}

export enum CohortGender {
  male = 'male',
  female = 'female',
  other = 'other',
  unknown = 'unknown',
}

export class CohortCriteriaDto {
  @ApiPropertyOptional({ type: AgeRangeDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => AgeRangeDto)
  ageRange?: AgeRangeDto;

  @ApiPropertyOptional({ enum: CohortGender })
  @IsOptional()
  @IsEnum(CohortGender)
  gender?: CohortGender;

  @ApiPropertyOptional({
    type: [Number],
    description: 'OMOP condition_concept_id list',
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  conditions?: number[];

  @ApiPropertyOptional({
    type: [Number],
    description: 'OMOP drug_concept_id list',
  })
  @IsOptional()
  @IsArray()
  @IsInt({ each: true })
  medications?: number[];
}

export class CohortQueryDto {
  @ApiProperty({ type: CohortCriteriaDto })
  @ValidateNested()
  @Type(() => CohortCriteriaDto)
  criteria!: CohortCriteriaDto;
}

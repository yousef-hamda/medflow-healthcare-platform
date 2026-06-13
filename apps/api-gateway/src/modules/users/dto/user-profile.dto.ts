import { ApiProperty } from '@nestjs/swagger';

export class UserProfileDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  username!: string;

  @ApiProperty()
  role!: string;

  @ApiProperty()
  displayName!: string;

  @ApiProperty({ nullable: true, type: String })
  email!: string | null;

  @ApiProperty({ nullable: true, type: String })
  phone!: string | null;

  @ApiProperty({ nullable: true, type: String })
  fhirPractitionerId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  fhirPatientId!: string | null;
}

export class CareTeamSummaryDto {
  @ApiProperty()
  careTeamId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  fhirPatientId!: string;

  @ApiProperty()
  role!: string;
}

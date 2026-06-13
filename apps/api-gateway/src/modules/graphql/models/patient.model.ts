import { Field, ObjectType } from '@nestjs/graphql';

/**
 * Read-only GraphQL projection of a FHIR Patient. PHI/identifier fields are
 * intentionally omitted — GraphQL exposes only the minimum-necessary subset.
 */
@ObjectType()
export class PatientModel {
  @Field()
  id!: string;

  @Field({ nullable: true })
  gender?: string;

  @Field({ nullable: true })
  birthDate?: string;

  @Field({ nullable: true })
  displayName?: string;
}

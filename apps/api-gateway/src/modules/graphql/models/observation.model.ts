import { Field, Float, ObjectType } from '@nestjs/graphql';

/** Read-only GraphQL projection of a FHIR Observation. */
@ObjectType()
export class ObservationModel {
  @Field()
  id!: string;

  @Field()
  code!: string;

  @Field({ nullable: true })
  display?: string;

  @Field(() => Float, { nullable: true })
  value?: number;

  @Field({ nullable: true })
  unit?: string;

  @Field({ nullable: true })
  effectiveDateTime?: string;
}

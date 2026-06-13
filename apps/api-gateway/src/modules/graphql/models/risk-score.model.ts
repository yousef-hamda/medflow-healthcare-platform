import { Field, Float, ObjectType } from '@nestjs/graphql';

/** Latest cached risk score for a patient (sourced from Redis). */
@ObjectType()
export class RiskScoreModel {
  @Field()
  patientId!: string;

  @Field(() => Float, { nullable: true })
  score?: number;

  @Field({ nullable: true })
  band?: string;

  @Field({ nullable: true })
  model?: string;
}

/** Aggregated patient view stitched across FHIR + risk cache. */
@ObjectType()
export class PatientAggregateModel {
  @Field()
  patientId!: string;

  @Field(() => Float)
  observationCount!: number;

  @Field(() => RiskScoreModel, { nullable: true })
  latestRisk?: RiskScoreModel;
}

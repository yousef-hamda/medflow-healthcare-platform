import { Args, Context, Query, Resolver } from '@nestjs/graphql';
import { UseGuards } from '@nestjs/common';
import { GqlAuthGuard, type GqlAuthedRequest } from './gql-auth.guard';
import { GraphqlService } from './graphql.service';
import { PatientModel } from './models/patient.model';
import { ObservationModel } from './models/observation.model';
import {
  PatientAggregateModel,
  RiskScoreModel,
} from './models/risk-score.model';
import type { SmartScope } from '@medflow/shared-types';

interface GqlCtx {
  req: GqlAuthedRequest;
}

/**
 * Read-only GraphQL surface. Every resolver flows through the FHIR proxy (so
 * patient-context narrowing + minimum-necessary masking still apply) or the
 * Redis risk cache. No mutations are exposed.
 */
@Resolver()
@UseGuards(GqlAuthGuard)
export class PatientResolver {
  constructor(private readonly service: GraphqlService) {}

  private scopes(ctx: GqlCtx): readonly SmartScope[] {
    return ctx.req.grantedScopes ?? [];
  }

  private contextPatient(ctx: GqlCtx): string | undefined {
    return ctx.req.user?.patient;
  }

  @Query(() => PatientModel, { nullable: true })
  patient(
    @Args('id') id: string,
    @Context() ctx: GqlCtx,
  ): Promise<PatientModel | null> {
    return this.service.getPatient(id, this.scopes(ctx), this.contextPatient(ctx));
  }

  @Query(() => [ObservationModel])
  observations(
    @Args('patientId') patientId: string,
    @Context() ctx: GqlCtx,
  ): Promise<ObservationModel[]> {
    return this.service.getObservations(
      patientId,
      this.scopes(ctx),
      this.contextPatient(ctx),
    );
  }

  @Query(() => RiskScoreModel, { nullable: true })
  latestRisk(
    @Args('patientId') patientId: string,
  ): Promise<RiskScoreModel | null> {
    return this.service.getLatestRisk(patientId);
  }

  @Query(() => PatientAggregateModel)
  patientAggregate(
    @Args('patientId') patientId: string,
    @Context() ctx: GqlCtx,
  ): Promise<PatientAggregateModel> {
    return this.service.getPatientAggregate(
      patientId,
      this.scopes(ctx),
      this.contextPatient(ctx),
    );
  }
}

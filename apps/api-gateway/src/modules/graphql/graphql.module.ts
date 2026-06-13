import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FhirProxyModule } from '../fhir-proxy/fhir-proxy.module';
import { GraphqlService } from './graphql.service';
import { PatientResolver } from './patient.resolver';
import { GqlAuthGuard } from './gql-auth.guard';

/**
 * Feature module hosting the read-only GraphQL resolvers. The Apollo driver and
 * schema generation are configured globally in app.module.ts
 * (GraphQLModule.forRoot with autoSchemaFile).
 */
@Module({
  imports: [AuthModule, FhirProxyModule],
  providers: [GraphqlService, PatientResolver, GqlAuthGuard],
})
export class GraphqlModule {}

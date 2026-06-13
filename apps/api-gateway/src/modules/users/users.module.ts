import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from '../auth/auth.module';
import { User } from './entities/user.entity';
import { Clinician } from './entities/clinician.entity';
import { PatientLink } from './entities/patient-link.entity';
import { CareTeam } from './entities/care-team.entity';
import { CareTeamMembership } from './entities/care-team-membership.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      Clinician,
      PatientLink,
      CareTeam,
      CareTeamMembership,
    ]),
    AuthModule,
  ],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}

/**
 * TypeORM DataSource for the migration CLI (`pnpm migration:run`).
 *
 * The running application configures TypeORM via TypeOrmModule.forRootAsync in
 * app.module.ts; this standalone DataSource exists only so the CLI can apply
 * and generate migrations against the same schema.
 */

import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { User } from './modules/users/entities/user.entity';
import { Clinician } from './modules/users/entities/clinician.entity';
import { PatientLink } from './modules/users/entities/patient-link.entity';
import { CareTeam } from './modules/users/entities/care-team.entity';
import { CareTeamMembership } from './modules/users/entities/care-team-membership.entity';
import { MessageThread } from './modules/messaging/entities/message-thread.entity';
import { Message } from './modules/messaging/entities/message.entity';
import { Appointment } from './modules/appointments/entities/appointment.entity';
import { ShareToken } from './modules/share/entities/share-token.entity';

export default new DataSource({
  type: 'postgres',
  url:
    process.env['DATABASE_URL'] ??
    'postgresql://medflow:medflow_dev_password@localhost:5432/gateway',
  entities: [
    User,
    Clinician,
    PatientLink,
    CareTeam,
    CareTeamMembership,
    MessageThread,
    Message,
    Appointment,
    ShareToken,
  ],
  migrations: ['src/migrations/*.ts'],
  synchronize: false,
  logging: false,
});

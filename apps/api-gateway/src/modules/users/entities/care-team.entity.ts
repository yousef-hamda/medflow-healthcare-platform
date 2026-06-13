import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { CareTeamMembership } from './care-team-membership.entity';

/**
 * A care team caring for a single FHIR Patient. Clinician membership in a
 * patient's care team is the basis for the ABAC `clinician-care-team-overlap`
 * policy that authorizes clinical reads.
 */
@Entity({ name: 'care_teams' })
export class CareTeam {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 256 })
  name!: string;

  @Index()
  @Column({ name: 'fhir_patient_id', type: 'varchar', length: 64 })
  fhirPatientId!: string;

  @OneToMany(
    'CareTeamMembership',
    (membership: CareTeamMembership) => membership.careTeam,
  )
  memberships!: CareTeamMembership[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

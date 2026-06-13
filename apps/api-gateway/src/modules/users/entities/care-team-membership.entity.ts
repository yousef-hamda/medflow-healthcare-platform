import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { CareTeam } from './care-team.entity';
import { Clinician } from './clinician.entity';

export type CareTeamRole = 'attending' | 'consulting' | 'nurse' | 'coordinator';

/** Join row: one clinician's membership in one care team. */
@Entity({ name: 'care_team_memberships' })
@Unique(['careTeamId', 'clinicianId'])
export class CareTeamMembership {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => CareTeam, (team) => team.memberships, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'care_team_id' })
  careTeam!: CareTeam;

  @Index()
  @Column({ name: 'care_team_id', type: 'uuid' })
  careTeamId!: string;

  @ManyToOne(() => Clinician, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'clinician_id' })
  clinician!: Clinician;

  @Index()
  @Column({ name: 'clinician_id', type: 'uuid' })
  clinicianId!: string;

  @Column({ type: 'varchar', length: 32, default: 'consulting' })
  role!: CareTeamRole;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

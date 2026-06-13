import {
  Column,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './user.entity';

/**
 * Clinician profile linked 1:1 to a User. The `fhirPractitionerId` ties the
 * clinician to a FHIR Practitioner resource and is used by the FHIR proxy and
 * ABAC care-team checks.
 */
@Entity({ name: 'clinicians' })
export class Clinician {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @OneToOne(() => User, (user) => user.clinician, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Index({ unique: true })
  @Column({ name: 'fhir_practitioner_id', type: 'varchar', length: 64 })
  fhirPractitionerId!: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  specialty!: string | null;

  /** NPI or equivalent registration number (non-PHI professional id). */
  @Column({ type: 'varchar', length: 32, nullable: true })
  npi!: string | null;
}

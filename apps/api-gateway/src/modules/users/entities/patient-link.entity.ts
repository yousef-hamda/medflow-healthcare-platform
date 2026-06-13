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
 * Links a patient-role User to their FHIR Patient resource. Used to enforce
 * patient-self-access in ABAC and to narrow patient-context FHIR reads.
 */
@Entity({ name: 'patient_links' })
export class PatientLink {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @OneToOne(() => User, (user) => user.patientLink, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Index({ unique: true })
  @Column({ name: 'fhir_patient_id', type: 'varchar', length: 64 })
  fhirPatientId!: string;
}

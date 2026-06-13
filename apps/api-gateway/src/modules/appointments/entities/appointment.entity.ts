import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type AppointmentStatus =
  | 'booked'
  | 'arrived'
  | 'fulfilled'
  | 'cancelled'
  | 'noshow';

/** A scheduled appointment between a patient and a practitioner. */
@Entity({ name: 'appointments' })
export class Appointment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ name: 'fhir_patient_id', type: 'varchar', length: 64 })
  fhirPatientId!: string;

  @Index()
  @Column({ name: 'fhir_practitioner_id', type: 'varchar', length: 64 })
  fhirPractitionerId!: string;

  @Column({ type: 'varchar', length: 32, default: 'booked' })
  status!: AppointmentStatus;

  @Column({ type: 'timestamptz' })
  start!: Date;

  @Column({ type: 'timestamptz' })
  end!: Date;

  @Column({ type: 'varchar', length: 512, nullable: true })
  reason!: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Message } from './message.entity';

/**
 * A messaging thread scoped to a single patient. Participants are restricted to
 * the patient's care team; the column stores participant user ids as a
 * space-delimited string. Message bodies live in the Message entity and are
 * never logged.
 */
@Entity({ name: 'message_threads' })
export class MessageThread {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 256 })
  subject!: string;

  @Index()
  @Column({ name: 'fhir_patient_id', type: 'varchar', length: 64 })
  fhirPatientId!: string;

  @Column({
    name: 'participant_user_ids',
    type: 'text',
    default: '',
    transformer: {
      to: (value: string[] | undefined): string => (value ?? []).join(' '),
      from: (value: string): string[] =>
        value.length > 0 ? value.split(' ') : [],
    },
  })
  participantUserIds!: string[];

  @OneToMany('Message', (message: Message) => message.thread)
  messages!: Message[];

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

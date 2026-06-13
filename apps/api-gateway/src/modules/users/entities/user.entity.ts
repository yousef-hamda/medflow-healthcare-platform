import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { Clinician } from './clinician.entity';
import type { PatientLink } from './patient-link.entity';

export type UserRole = 'clinician' | 'patient' | 'admin' | 'service';

/**
 * Application user / OAuth subject.
 *
 * PHI columns (email, phone) are NOT stored in plaintext: they hold Vault
 * Transit envelope ciphertext of the form `vault:v1:...` produced by
 * VaultCryptoService. Decryption happens only in the service layer for
 * authorized reads.
 */
@Entity({ name: 'users' })
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 128 })
  username!: string;

  @Column({ type: 'varchar', length: 32 })
  role!: UserRole;

  /** Display name (non-PHI label, e.g. "Dr. Rivera"). */
  @Column({ type: 'varchar', length: 256 })
  displayName!: string;

  /** Vault-encrypted email — `vault:v1:...`. Nullable for service accounts. */
  @Column({ type: 'text', nullable: true })
  emailEnc!: string | null;

  /** Vault-encrypted phone — `vault:v1:...`. */
  @Column({ type: 'text', nullable: true })
  phoneEnc!: string | null;

  /**
   * Password hash. In this synthetic demo the value is compared directly by
   * AuthService.handlePassword; production would store an argon2/bcrypt hash.
   */
  @Column({ type: 'varchar', length: 256, default: '' })
  passwordHash!: string;

  @OneToOne('Clinician', (clinician: Clinician) => clinician.user)
  clinician?: Clinician;

  @OneToOne('PatientLink', (link: PatientLink) => link.user)
  patientLink?: PatientLink;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}

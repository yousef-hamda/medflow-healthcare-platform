import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  VaultCryptoService,
  VAULT_UNAVAILABLE_PLACEHOLDER,
} from '../vault/vault-crypto.service';
import { VAULT_CRYPTO_SERVICE } from '../vault/vault.module';
import { User } from './entities/user.entity';
import { Clinician } from './entities/clinician.entity';
import { PatientLink } from './entities/patient-link.entity';
import { CareTeam } from './entities/care-team.entity';
import { CareTeamMembership } from './entities/care-team-membership.entity';

/** Ciphertext prefix produced by Vault Transit; never persist non-prefixed PHI. */
const VAULT_CIPHERTEXT_PREFIX = 'vault:';

export interface UserProfile {
  id: string;
  username: string;
  role: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  fhirPractitionerId: string | null;
  fhirPatientId: string | null;
}

export interface CareTeamSummary {
  careTeamId: string;
  name: string;
  fhirPatientId: string;
  role: string;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Clinician)
    private readonly clinicians: Repository<Clinician>,
    @InjectRepository(PatientLink)
    private readonly patientLinks: Repository<PatientLink>,
    @InjectRepository(CareTeam)
    private readonly careTeams: Repository<CareTeam>,
    @InjectRepository(CareTeamMembership)
    private readonly memberships: Repository<CareTeamMembership>,
    @Inject(VAULT_CRYPTO_SERVICE) private readonly vault: VaultCryptoService,
  ) {}

  // ── Envelope encryption helpers ──────────────────────────────────────────

  /** Encrypts a contact field for storage; null passes through unchanged. */
  async encryptField(plaintext: string | null): Promise<string | null> {
    if (plaintext === null || plaintext.length === 0) return null;
    return this.vault.encrypt(plaintext);
  }

  /**
   * Decrypts a stored `vault:v1:...` ciphertext. Plain (non-prefixed) values
   * are returned as-is so legacy/seed rows do not break reads.
   */
  private async decryptField(ciphertext: string | null): Promise<string | null> {
    if (ciphertext === null || ciphertext.length === 0) return null;
    if (!ciphertext.startsWith(VAULT_CIPHERTEXT_PREFIX)) return ciphertext;
    const value = await this.vault.decrypt(ciphertext);
    return value === VAULT_UNAVAILABLE_PLACEHOLDER ? null : value;
  }

  // ── Profile ──────────────────────────────────────────────────────────────

  async findById(userId: string): Promise<User> {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async getProfile(userId: string): Promise<UserProfile> {
    const user = await this.findById(userId);
    const clinician = await this.clinicians.findOne({ where: { userId } });
    const patientLink = await this.patientLinks.findOne({ where: { userId } });

    const [email, phone] = await Promise.all([
      this.decryptField(user.emailEnc),
      this.decryptField(user.phoneEnc),
    ]);

    return {
      id: user.id,
      username: user.username,
      role: user.role,
      displayName: user.displayName,
      email,
      phone,
      fhirPractitionerId: clinician?.fhirPractitionerId ?? null,
      fhirPatientId: patientLink?.fhirPatientId ?? null,
    };
  }

  // ── Care-team lookup ──────────────────────────────────────────────────────

  /** Care teams a clinician belongs to (by their user id). */
  async getCareTeamsForUser(userId: string): Promise<CareTeamSummary[]> {
    const clinician = await this.clinicians.findOne({ where: { userId } });
    if (!clinician) return [];

    const rows = await this.memberships.find({
      where: { clinicianId: clinician.id },
      relations: { careTeam: true },
    });

    return rows.map((m) => ({
      careTeamId: m.careTeamId,
      name: m.careTeam.name,
      fhirPatientId: m.careTeam.fhirPatientId,
      role: m.role,
    }));
  }

  /**
   * FHIR Patient ids a clinician is authorized to access via care-team
   * membership. Backs the ABAC clinician-care-team-overlap policy and the
   * analytics worklist.
   */
  async getCareTeamPatientIds(userId: string): Promise<string[]> {
    const teams = await this.getCareTeamsForUser(userId);
    return [...new Set(teams.map((t) => t.fhirPatientId))];
  }

  /**
   * True when a clinician shares a care team with the given patient — i.e. the
   * clinician is on a care team whose `fhirPatientId` matches `patientId`.
   */
  async clinicianSharesCareTeam(
    userId: string,
    patientId: string,
  ): Promise<boolean> {
    const ids = await this.getCareTeamPatientIds(userId);
    return ids.includes(patientId);
  }

  /** FHIR Patient id linked to a patient-role user, if any. */
  async getLinkedPatientId(userId: string): Promise<string | null> {
    const link = await this.patientLinks.findOne({ where: { userId } });
    return link?.fhirPatientId ?? null;
  }
}

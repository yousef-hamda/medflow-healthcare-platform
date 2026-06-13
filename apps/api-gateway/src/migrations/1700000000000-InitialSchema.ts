import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial schema for the gateway database.
 *
 * Contact PHI columns (users.email_enc, users.phone_enc) hold Vault Transit
 * envelope ciphertext (`vault:v1:...`), never plaintext. Message bodies live in
 * a dedicated column and are excluded from all logging.
 */
export class InitialSchema1700000000000 implements MigrationInterface {
  name = 'InitialSchema1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');

    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "username" varchar(128) NOT NULL,
        "role" varchar(32) NOT NULL,
        "displayName" varchar(256) NOT NULL,
        "emailEnc" text,
        "phoneEnc" text,
        "passwordHash" varchar(256) NOT NULL DEFAULT '',
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "UQ_users_username" ON "users" ("username")',
    );

    await queryRunner.query(`
      CREATE TABLE "clinicians" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "fhir_practitioner_id" varchar(64) NOT NULL,
        "specialty" varchar(128),
        "npi" varchar(32),
        CONSTRAINT "PK_clinicians" PRIMARY KEY ("id"),
        CONSTRAINT "FK_clinicians_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )`);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "UQ_clinicians_practitioner" ON "clinicians" ("fhir_practitioner_id")',
    );

    await queryRunner.query(`
      CREATE TABLE "patient_links" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "fhir_patient_id" varchar(64) NOT NULL,
        CONSTRAINT "PK_patient_links" PRIMARY KEY ("id"),
        CONSTRAINT "FK_patient_links_user" FOREIGN KEY ("user_id")
          REFERENCES "users"("id") ON DELETE CASCADE
      )`);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "UQ_patient_links_patient" ON "patient_links" ("fhir_patient_id")',
    );

    await queryRunner.query(`
      CREATE TABLE "care_teams" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" varchar(256) NOT NULL,
        "fhir_patient_id" varchar(64) NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_care_teams" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      'CREATE INDEX "IDX_care_teams_patient" ON "care_teams" ("fhir_patient_id")',
    );

    await queryRunner.query(`
      CREATE TABLE "care_team_memberships" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "care_team_id" uuid NOT NULL,
        "clinician_id" uuid NOT NULL,
        "role" varchar(32) NOT NULL DEFAULT 'consulting',
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_care_team_memberships" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_care_team_member" UNIQUE ("care_team_id", "clinician_id"),
        CONSTRAINT "FK_ctm_team" FOREIGN KEY ("care_team_id")
          REFERENCES "care_teams"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ctm_clinician" FOREIGN KEY ("clinician_id")
          REFERENCES "clinicians"("id") ON DELETE CASCADE
      )`);
    await queryRunner.query(
      'CREATE INDEX "IDX_ctm_team" ON "care_team_memberships" ("care_team_id")',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_ctm_clinician" ON "care_team_memberships" ("clinician_id")',
    );

    await queryRunner.query(`
      CREATE TABLE "message_threads" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "subject" varchar(256) NOT NULL,
        "fhir_patient_id" varchar(64) NOT NULL,
        "participant_user_ids" text NOT NULL DEFAULT '',
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_message_threads" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      'CREATE INDEX "IDX_threads_patient" ON "message_threads" ("fhir_patient_id")',
    );

    await queryRunner.query(`
      CREATE TABLE "messages" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "thread_id" uuid NOT NULL,
        "sender_user_id" uuid NOT NULL,
        "body" text NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_messages" PRIMARY KEY ("id"),
        CONSTRAINT "FK_messages_thread" FOREIGN KEY ("thread_id")
          REFERENCES "message_threads"("id") ON DELETE CASCADE
      )`);
    await queryRunner.query(
      'CREATE INDEX "IDX_messages_thread" ON "messages" ("thread_id")',
    );

    await queryRunner.query(`
      CREATE TABLE "appointments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "fhir_patient_id" varchar(64) NOT NULL,
        "fhir_practitioner_id" varchar(64) NOT NULL,
        "status" varchar(32) NOT NULL DEFAULT 'booked',
        "start" timestamptz NOT NULL,
        "end" timestamptz NOT NULL,
        "reason" varchar(512),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_appointments" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      'CREATE INDEX "IDX_appt_patient" ON "appointments" ("fhir_patient_id")',
    );
    await queryRunner.query(
      'CREATE INDEX "IDX_appt_practitioner" ON "appointments" ("fhir_practitioner_id")',
    );

    await queryRunner.query(`
      CREATE TABLE "share_tokens" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "client_id" varchar(128) NOT NULL,
        "client_secret" varchar(256) NOT NULL,
        "owner_id" uuid NOT NULL,
        "scopes" text NOT NULL DEFAULT '',
        "revoked" boolean NOT NULL DEFAULT false,
        "expiresAt" timestamptz NOT NULL,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_share_tokens" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      'CREATE UNIQUE INDEX "UQ_share_client" ON "share_tokens" ("client_id")',
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS "share_tokens"');
    await queryRunner.query('DROP TABLE IF EXISTS "appointments"');
    await queryRunner.query('DROP TABLE IF EXISTS "messages"');
    await queryRunner.query('DROP TABLE IF EXISTS "message_threads"');
    await queryRunner.query('DROP TABLE IF EXISTS "care_team_memberships"');
    await queryRunner.query('DROP TABLE IF EXISTS "care_teams"');
    await queryRunner.query('DROP TABLE IF EXISTS "patient_links"');
    await queryRunner.query('DROP TABLE IF EXISTS "clinicians"');
    await queryRunner.query('DROP TABLE IF EXISTS "users"');
  }
}

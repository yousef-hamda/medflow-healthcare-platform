import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * A client-credentials "share" grant: a mini OAuth client minted so an external
 * party (e.g. a referred specialist) can pull a narrow, time-boxed slice of
 * data. Revocation is enforced two ways: the `revoked` flag here AND a Redis
 * revocation list checked at token-issue and request time.
 */
@Entity({ name: 'share_tokens' })
export class ShareToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ name: 'client_id', type: 'varchar', length: 128 })
  clientId!: string;

  @Column({ name: 'client_secret', type: 'varchar', length: 256 })
  clientSecret!: string;

  /** User id of the share creator (the granting subject). */
  @Column({ name: 'owner_id', type: 'uuid' })
  ownerId!: string;

  /** Granted scopes, stored as a space-delimited string. */
  @Column({
    type: 'text',
    default: '',
    transformer: {
      to: (value: string[] | undefined): string => (value ?? []).join(' '),
      from: (value: string): string[] =>
        value.length > 0 ? value.split(' ') : [],
    },
  })
  scopes!: string[];

  @Column({ type: 'boolean', default: false })
  revoked!: boolean;

  @Column({ name: 'expiresAt', type: 'timestamptz' })
  expiresAt!: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

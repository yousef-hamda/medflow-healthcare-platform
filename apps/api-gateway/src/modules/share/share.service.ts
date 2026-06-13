import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes, randomUUID } from 'crypto';
import type { Redis } from 'ioredis';
import { REDIS_TOKEN } from '../rate-limit/redis.provider';
import { ShareToken } from './entities/share-token.entity';
import type { CreateShareTokenDto } from './dto/create-share-token.dto';

const MAX_EXPIRES_HOURS = 72;
/** Redis key marking a share id as revoked (checked at token issue + request). */
const revokedKey = (id: string): string => `share:revoked:${id}`;

export interface ShareTokenCredentials {
  id: string;
  clientId: string;
  /** Returned ONCE at creation time — never stored or returned again. */
  clientSecret: string;
  scopes: string[];
  expiresAt: string;
}

export interface ShareTokenView {
  id: string;
  clientId: string;
  scopes: string[];
  revoked: boolean;
  expiresAt: string;
  createdAt: string;
}

@Injectable()
export class ShareService {
  constructor(
    @InjectRepository(ShareToken)
    private readonly repo: Repository<ShareToken>,
    @Inject(REDIS_TOKEN) private readonly redis: Redis,
  ) {}

  async create(
    ownerId: string,
    dto: CreateShareTokenDto,
  ): Promise<ShareTokenCredentials> {
    if (dto.expiresInHours > MAX_EXPIRES_HOURS) {
      throw new ForbiddenException(
        `expiresInHours must not exceed ${MAX_EXPIRES_HOURS}`,
      );
    }
    const clientId = `share-${randomUUID()}`;
    const clientSecret = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + dto.expiresInHours * 3_600_000);

    const entity = this.repo.create({
      clientId,
      clientSecret,
      ownerId,
      scopes: dto.scopes,
      revoked: false,
      expiresAt,
    });
    const saved = await this.repo.save(entity);

    return {
      id: saved.id,
      clientId,
      clientSecret,
      scopes: saved.scopes,
      expiresAt: expiresAt.toISOString(),
    };
  }

  async listForOwner(ownerId: string): Promise<ShareTokenView[]> {
    const rows = await this.repo.find({
      where: { ownerId },
      order: { createdAt: 'DESC' },
    });
    return rows.map((r) => this.toView(r));
  }

  async getForOwner(ownerId: string, id: string): Promise<ShareTokenView> {
    const row = await this.repo.findOne({ where: { id, ownerId } });
    if (!row) throw new NotFoundException('Share token not found');
    return this.toView(row);
  }

  /** Soft-revokes the grant and adds it to the Redis revocation list. */
  async revoke(ownerId: string, id: string): Promise<void> {
    const row = await this.repo.findOne({ where: { id, ownerId } });
    if (!row) throw new NotFoundException('Share token not found');
    row.revoked = true;
    await this.repo.save(row);

    const ttl = Math.max(
      1,
      Math.ceil((row.expiresAt.getTime() - Date.now()) / 1000),
    );
    await this.redis.set(revokedKey(id), '1', 'EX', ttl);
  }

  private toView(row: ShareToken): ShareTokenView {
    return {
      id: row.id,
      clientId: row.clientId,
      scopes: row.scopes,
      revoked: row.revoked,
      expiresAt: row.expiresAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
    };
  }
}

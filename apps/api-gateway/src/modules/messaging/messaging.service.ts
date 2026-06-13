import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UsersService } from '../users/users.service';
import { MessageThread } from './entities/message-thread.entity';
import { Message } from './entities/message.entity';
import type { CreateThreadDto, CreateMessageDto } from './dto/messaging.dto';

export interface ThreadView {
  id: string;
  subject: string;
  patientId: string;
  participantUserIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface MessageView {
  id: string;
  threadId: string;
  senderUserId: string;
  body: string;
  createdAt: string;
}

@Injectable()
export class MessagingService {
  constructor(
    @InjectRepository(MessageThread)
    private readonly threads: Repository<MessageThread>,
    @InjectRepository(Message)
    private readonly messages: Repository<Message>,
    private readonly usersService: UsersService,
  ) {}

  /**
   * Authorizes a user to participate in a patient's thread: clinicians must
   * share the patient's care team; patients must be the linked patient.
   */
  private async assertParticipant(
    userId: string,
    patientId: string,
  ): Promise<void> {
    const sharesCareTeam = await this.usersService.clinicianSharesCareTeam(
      userId,
      patientId,
    );
    const linked = await this.usersService.getLinkedPatientId(userId);
    if (!sharesCareTeam && linked !== patientId) {
      throw new ForbiddenException(
        'Not a care-team participant for this patient',
      );
    }
  }

  private async loadThreadFor(
    userId: string,
    threadId: string,
  ): Promise<MessageThread> {
    const thread = await this.threads.findOne({ where: { id: threadId } });
    if (!thread) throw new NotFoundException('Thread not found');
    if (!thread.participantUserIds.includes(userId)) {
      throw new ForbiddenException('Not a participant of this thread');
    }
    return thread;
  }

  async createThread(
    userId: string,
    dto: CreateThreadDto,
  ): Promise<ThreadView> {
    await this.assertParticipant(userId, dto.patientId);
    const entity = this.threads.create({
      subject: dto.subject,
      fhirPatientId: dto.patientId,
      participantUserIds: [userId],
    });
    const saved = await this.threads.save(entity);
    return this.toThreadView(saved);
  }

  async listThreads(userId: string): Promise<ThreadView[]> {
    // QueryBuilder LIKE on the space-delimited participant column.
    const rows = await this.threads
      .createQueryBuilder('t')
      .where('t.participant_user_ids LIKE :uid', { uid: `%${userId}%` })
      .orderBy('t.updatedAt', 'DESC')
      .getMany();
    return rows
      .filter((t) => t.participantUserIds.includes(userId))
      .map((t) => this.toThreadView(t));
  }

  async getThread(userId: string, threadId: string): Promise<ThreadView> {
    const thread = await this.loadThreadFor(userId, threadId);
    return this.toThreadView(thread);
  }

  async addParticipant(
    userId: string,
    threadId: string,
    newUserId: string,
  ): Promise<ThreadView> {
    const thread = await this.loadThreadFor(userId, threadId);
    // New participant must also be authorized for this patient.
    await this.assertParticipant(newUserId, thread.fhirPatientId);
    if (!thread.participantUserIds.includes(newUserId)) {
      thread.participantUserIds = [...thread.participantUserIds, newUserId];
      await this.threads.save(thread);
    }
    return this.toThreadView(thread);
  }

  async postMessage(
    userId: string,
    threadId: string,
    dto: CreateMessageDto,
  ): Promise<MessageView> {
    await this.loadThreadFor(userId, threadId);
    const message = this.messages.create({
      threadId,
      senderUserId: userId,
      body: dto.body,
    });
    const saved = await this.messages.save(message);
    await this.threads.update({ id: threadId }, { updatedAt: new Date() });
    return this.toMessageView(saved);
  }

  async listMessages(
    userId: string,
    threadId: string,
  ): Promise<MessageView[]> {
    await this.loadThreadFor(userId, threadId);
    const rows = await this.messages.find({
      where: { threadId },
      order: { createdAt: 'ASC' },
    });
    return rows.map((m) => this.toMessageView(m));
  }

  private toThreadView(t: MessageThread): ThreadView {
    return {
      id: t.id,
      subject: t.subject,
      patientId: t.fhirPatientId,
      participantUserIds: t.participantUserIds,
      createdAt: t.createdAt.toISOString(),
      updatedAt: t.updatedAt.toISOString(),
    };
  }

  private toMessageView(m: Message): MessageView {
    return {
      id: m.id,
      threadId: m.threadId,
      senderUserId: m.senderUserId,
      body: m.body,
      createdAt: m.createdAt.toISOString(),
    };
  }
}

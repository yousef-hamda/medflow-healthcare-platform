import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { MessageThread } from './message-thread.entity';

/**
 * A single message within a thread. The `body` column holds clinical content
 * and is excluded from all logging via the pino redaction config in
 * app.module.ts (the `*.body` / `req.body.messageBody` redact paths).
 */
@Entity({ name: 'messages' })
export class Message {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @ManyToOne(() => MessageThread, (thread) => thread.messages, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'thread_id' })
  thread!: MessageThread;

  @Index()
  @Column({ name: 'thread_id', type: 'uuid' })
  threadId!: string;

  @Column({ name: 'sender_user_id', type: 'uuid' })
  senderUserId!: string;

  @Column({ type: 'text' })
  body!: string;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}

import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, type FindOptionsWhere, Repository } from 'typeorm';
import { Appointment } from './entities/appointment.entity';
import type {
  CreateAppointmentDto,
  UpdateAppointmentDto,
} from './dto/appointment.dto';

export interface AvailabilitySlot {
  start: string;
  end: string;
  available: boolean;
}

const SLOT_MINUTES = 30;

@Injectable()
export class AppointmentsService {
  constructor(
    @InjectRepository(Appointment)
    private readonly repo: Repository<Appointment>,
  ) {}

  async create(dto: CreateAppointmentDto): Promise<Appointment> {
    const start = new Date(dto.start);
    const end = new Date(dto.end);
    if (end <= start) {
      throw new BadRequestException('end must be after start');
    }
    const entity = this.repo.create({
      fhirPatientId: dto.patientId,
      fhirPractitionerId: dto.practitionerId,
      start,
      end,
      reason: dto.reason ?? null,
      status: 'booked',
    });
    return this.repo.save(entity);
  }

  async findOne(id: string): Promise<Appointment> {
    const appt = await this.repo.findOne({ where: { id } });
    if (!appt) throw new NotFoundException('Appointment not found');
    return appt;
  }

  list(filter: {
    patientId?: string;
    practitionerId?: string;
  }): Promise<Appointment[]> {
    const where: FindOptionsWhere<Appointment> = {};
    if (filter.patientId) where.fhirPatientId = filter.patientId;
    if (filter.practitionerId) where.fhirPractitionerId = filter.practitionerId;
    return this.repo.find({ where, order: { start: 'ASC' } });
  }

  async update(id: string, dto: UpdateAppointmentDto): Promise<Appointment> {
    const appt = await this.findOne(id);
    if (dto.patientId) appt.fhirPatientId = dto.patientId;
    if (dto.practitionerId) appt.fhirPractitionerId = dto.practitionerId;
    if (dto.start) appt.start = new Date(dto.start);
    if (dto.end) appt.end = new Date(dto.end);
    if (dto.reason !== undefined) appt.reason = dto.reason;
    if (dto.status) appt.status = dto.status;
    if (appt.end <= appt.start) {
      throw new BadRequestException('end must be after start');
    }
    return this.repo.save(appt);
  }

  async cancel(id: string): Promise<Appointment> {
    const appt = await this.findOne(id);
    appt.status = 'cancelled';
    return this.repo.save(appt);
  }

  /**
   * Availability stub — returns 30-minute slots across the practitioner's
   * working day (09:00–17:00 local) for the given date, marking those that
   * overlap an existing booking as unavailable. A production scheduler would
   * also honour the practitioner's FHIR Schedule/Slot resources.
   */
  async availability(
    practitionerId: string,
    date: string,
  ): Promise<AvailabilitySlot[]> {
    const day = new Date(`${date}T00:00:00.000Z`);
    if (Number.isNaN(day.getTime())) {
      throw new BadRequestException('Invalid date (expected YYYY-MM-DD)');
    }
    const dayStart = new Date(day);
    dayStart.setUTCHours(9, 0, 0, 0);
    const dayEnd = new Date(day);
    dayEnd.setUTCHours(17, 0, 0, 0);

    const booked = await this.repo.find({
      where: {
        fhirPractitionerId: practitionerId,
        start: Between(dayStart, dayEnd),
      },
    });

    const slots: AvailabilitySlot[] = [];
    for (
      let t = dayStart.getTime();
      t < dayEnd.getTime();
      t += SLOT_MINUTES * 60_000
    ) {
      const slotStart = new Date(t);
      const slotEnd = new Date(t + SLOT_MINUTES * 60_000);
      const overlaps = booked.some(
        (b) =>
          b.status !== 'cancelled' &&
          b.start < slotEnd &&
          b.end > slotStart,
      );
      slots.push({
        start: slotStart.toISOString(),
        end: slotEnd.toISOString(),
        available: !overlaps,
      });
    }
    return slots;
  }
}

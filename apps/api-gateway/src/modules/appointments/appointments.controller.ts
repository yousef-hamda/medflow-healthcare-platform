import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  AppointmentsService,
  type AvailabilitySlot,
} from './appointments.service';
import { Appointment } from './entities/appointment.entity';
import {
  CreateAppointmentDto,
  UpdateAppointmentDto,
} from './dto/appointment.dto';

@ApiTags('Appointments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Post()
  @ApiOperation({ summary: 'Book an appointment' })
  create(@Body() dto: CreateAppointmentDto): Promise<Appointment> {
    return this.appointments.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List appointments (filter by patient/practitioner)' })
  list(
    @Query('patientId') patientId?: string,
    @Query('practitionerId') practitionerId?: string,
  ): Promise<Appointment[]> {
    return this.appointments.list({ patientId, practitionerId });
  }

  @Get('availability')
  @ApiOperation({ summary: 'Practitioner availability slots for a date (stub)' })
  availability(
    @Query('practitionerId') practitionerId: string,
    @Query('date') date: string,
  ): Promise<AvailabilitySlot[]> {
    return this.appointments.availability(practitionerId, date);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an appointment' })
  get(@Param('id') id: string): Promise<Appointment> {
    return this.appointments.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an appointment' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateAppointmentDto,
  ): Promise<Appointment> {
    return this.appointments.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Cancel an appointment' })
  cancel(@Param('id') id: string): Promise<Appointment> {
    return this.appointments.cancel(id);
  }
}

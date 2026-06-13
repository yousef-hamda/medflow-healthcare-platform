package com.medflow.hl7ingester.mllp;

import ca.uhn.hl7v2.HL7Exception;
import ca.uhn.hl7v2.model.Message;
import ca.uhn.hl7v2.model.v25.message.ADT_A01;
import ca.uhn.hl7v2.model.v25.message.ORM_O01;
import ca.uhn.hl7v2.model.v25.message.ORU_R01;
import ca.uhn.hl7v2.model.v25.segment.MSH;
import com.medflow.hl7ingester.fhir.FhirResourceWriter;
import com.medflow.hl7ingester.kafka.RawMessagePublisher;
import com.medflow.hl7ingester.mapping.AdtToFhirMapper;
import com.medflow.hl7ingester.mapping.OruToFhirMapper;
import com.medflow.hl7ingester.mapping.OrmToFhirMapper;
import org.hl7.fhir.r4.model.Encounter;
import org.hl7.fhir.r4.model.Patient;
import org.hl7.fhir.r4.model.Reference;
import org.hl7.fhir.r4.model.ServiceRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Orchestrates the per-message processing pipeline: map to FHIR, persist via conditional create,
 * and mirror the raw message to Kafka.
 *
 * <p>Routing is by MSH-9 message type / trigger event. Only message type and control id are logged
 * (never PHI segment values).
 */
@Component
public class Hl7MessageProcessor {

  private static final Logger LOG = LoggerFactory.getLogger(Hl7MessageProcessor.class);

  private final AdtToFhirMapper adtMapper;
  private final OruToFhirMapper oruMapper;
  private final OrmToFhirMapper ormMapper;
  private final FhirResourceWriter fhirWriter;
  private final RawMessagePublisher rawPublisher;

  /**
   * Creates the processor.
   *
   * @param adtMapper    ADT-to-FHIR mapper
   * @param oruMapper    ORU-to-FHIR mapper
   * @param ormMapper    ORM-to-FHIR mapper
   * @param fhirWriter   FHIR resource writer
   * @param rawPublisher raw-message Kafka publisher
   */
  public Hl7MessageProcessor(
      final AdtToFhirMapper adtMapper,
      final OruToFhirMapper oruMapper,
      final OrmToFhirMapper ormMapper,
      final FhirResourceWriter fhirWriter,
      final RawMessagePublisher rawPublisher) {
    this.adtMapper = adtMapper;
    this.oruMapper = oruMapper;
    this.ormMapper = ormMapper;
    this.fhirWriter = fhirWriter;
    this.rawPublisher = rawPublisher;
  }

  /**
   * Processes a parsed HL7v2 message and mirrors the raw message to Kafka.
   *
   * @param message the parsed HAPI message
   * @param raw     the verbatim HL7v2 message
   * @throws HL7Exception if mapping fails
   */
  public void process(final Message message, final String raw) throws HL7Exception {
    final MSH msh = (MSH) message.get("MSH");
    final String messageCode = msh.getMessageType().getMessageCode().getValue();
    final String triggerEvent = msh.getMessageType().getTriggerEvent().getValue();
    final String messageType = messageCode + "^" + triggerEvent;
    final String controlId = msh.getMessageControlID().getValue();

    LOG.info("Processing HL7 message messageType={} controlId={}", messageType, controlId);

    switch (messageCode) {
      case "ADT" -> processAdt((ADT_A01) message);
      case "ORU" -> processOru((ORU_R01) message);
      case "ORM" -> processOrm((ORM_O01) message);
      default -> LOG.warn("Unsupported HL7 message code messageType={} controlId={}",
          messageType, controlId);
    }

    rawPublisher.publish(messageType, controlId, raw, "PROCESSED");
  }

  private void processAdt(final ADT_A01 adt) throws HL7Exception {
    final Patient patient = adtMapper.toPatient(adt);
    final String patientId = fhirWriter.conditionalCreate(patient);
    final Reference patientRef =
        patientId != null ? new Reference("Patient/" + patientId) : null;
    final Encounter encounter = adtMapper.toEncounter(adt, patientRef);
    fhirWriter.conditionalCreate(encounter);
  }

  private void processOru(final ORU_R01 oru) throws HL7Exception {
    final var reports = oruMapper.toReports(oru, null);
    for (final var report : reports) {
      for (final var observation : report.observations()) {
        fhirWriter.conditionalCreate(observation);
      }
      fhirWriter.conditionalCreate(report.report());
    }
  }

  private void processOrm(final ORM_O01 orm) throws HL7Exception {
    for (final ServiceRequest request : ormMapper.toServiceRequests(orm, null)) {
      fhirWriter.conditionalCreate(request);
    }
  }
}

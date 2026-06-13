package com.medflow.hl7ingester.mapping;

import ca.uhn.hl7v2.HL7Exception;
import ca.uhn.hl7v2.model.v25.group.ORU_R01_OBSERVATION;
import ca.uhn.hl7v2.model.v25.group.ORU_R01_ORDER_OBSERVATION;
import ca.uhn.hl7v2.model.v25.group.ORU_R01_PATIENT_RESULT;
import ca.uhn.hl7v2.model.v25.message.ORU_R01;
import ca.uhn.hl7v2.model.v25.segment.OBR;
import ca.uhn.hl7v2.model.v25.segment.OBX;
import java.util.ArrayList;
import java.util.List;
import org.hl7.fhir.r4.model.CodeableConcept;
import org.hl7.fhir.r4.model.Coding;
import org.hl7.fhir.r4.model.DiagnosticReport;
import org.hl7.fhir.r4.model.Observation;
import org.hl7.fhir.r4.model.Quantity;
import org.hl7.fhir.r4.model.Reference;
import org.springframework.stereotype.Component;

/**
 * Maps HL7v2 ORU^R01 result messages to FHIR R4 resources.
 *
 * <p>Each OBX segment becomes an {@link Observation} (coded with LOINC where the OBX-3 identifier
 * names the LOINC system), and each OBR order becomes a {@link DiagnosticReport} that references
 * the contained observations.
 */
@Component
public class OruToFhirMapper {

  private static final String LOINC_SYSTEM = "http://loinc.org";
  private static final String OBS_IDENTIFIER_SYSTEM = "urn:medflow:observation-id";
  private static final String REPORT_IDENTIFIER_SYSTEM = "urn:medflow:filler-order-number";

  /**
   * Holds the FHIR resources produced from a single OBR order group.
   *
   * @param report       the DiagnosticReport for the order
   * @param observations the observations contained in the report
   */
  public record MappedReport(DiagnosticReport report, List<Observation> observations) {
  }

  /**
   * Maps every OBR order group of an ORU^R01 message to a {@link MappedReport}.
   *
   * @param oru        the parsed ORU^R01 message
   * @param patientRef a reference to the subject Patient (may be {@code null})
   * @return one mapped report per OBR in the message
   * @throws HL7Exception if required fields cannot be read
   */
  public List<MappedReport> toReports(final ORU_R01 oru, final Reference patientRef)
      throws HL7Exception {
    final List<MappedReport> reports = new ArrayList<>();
    final ORU_R01_PATIENT_RESULT patientResult = oru.getPATIENT_RESULT();

    for (int i = 0; i < patientResult.getORDER_OBSERVATIONReps(); i++) {
      final ORU_R01_ORDER_OBSERVATION orderObs = patientResult.getORDER_OBSERVATION(i);
      final OBR obr = orderObs.getOBR();

      final DiagnosticReport report = new DiagnosticReport();
      report.setStatus(DiagnosticReport.DiagnosticReportStatus.FINAL);
      final String fillerOrder = value(obr.getFillerOrderNumber().getEntityIdentifier().getValue());
      if (fillerOrder != null) {
        report.addIdentifier().setSystem(REPORT_IDENTIFIER_SYSTEM).setValue(fillerOrder);
      }
      report.setCode(codeFromCe(
          value(obr.getUniversalServiceIdentifier().getIdentifier().getValue()),
          value(obr.getUniversalServiceIdentifier().getText().getValue()),
          value(obr.getUniversalServiceIdentifier().getNameOfCodingSystem().getValue())));
      if (patientRef != null) {
        report.setSubject(patientRef);
      }

      final List<Observation> observations = new ArrayList<>();
      for (int j = 0; j < orderObs.getOBSERVATIONReps(); j++) {
        final ORU_R01_OBSERVATION observationGroup = orderObs.getOBSERVATION(j);
        final OBX obx = observationGroup.getOBX();
        final Observation observation = toObservation(obx, patientRef);
        observations.add(observation);
        report.addResult(new Reference("Observation"));
      }

      reports.add(new MappedReport(report, observations));
    }
    return reports;
  }

  /**
   * Maps a single OBX segment to a FHIR {@link Observation}.
   *
   * @param obx        the OBX segment
   * @param patientRef a reference to the subject Patient (may be {@code null})
   * @return the mapped Observation
   * @throws HL7Exception if required fields cannot be read
   */
  public Observation toObservation(final OBX obx, final Reference patientRef) throws HL7Exception {
    final Observation observation = new Observation();
    observation.setStatus(mapStatus(value(obx.getObservationResultStatus().getValue())));

    final String obsId = value(obx.getObservationIdentifier().getIdentifier().getValue());
    if (obsId != null) {
      observation.addIdentifier().setSystem(OBS_IDENTIFIER_SYSTEM).setValue(obsId);
    }

    observation.setCode(codeFromCe(
        obsId,
        value(obx.getObservationIdentifier().getText().getValue()),
        value(obx.getObservationIdentifier().getNameOfCodingSystem().getValue())));

    if (patientRef != null) {
      observation.setSubject(patientRef);
    }

    final String rawValue = firstObservationValue(obx);
    final String units = value(obx.getUnits().getIdentifier().getValue());
    if (rawValue != null) {
      final Double numeric = tryParseDouble(rawValue);
      if (numeric != null) {
        final Quantity quantity = new Quantity().setValue(numeric);
        if (units != null) {
          quantity.setUnit(units).setCode(units).setSystem("http://unitsofmeasure.org");
        }
        observation.setValue(quantity);
      } else {
        observation.setValue(new org.hl7.fhir.r4.model.StringType(rawValue));
      }
    }
    return observation;
  }

  private CodeableConcept codeFromCe(final String code, final String display, final String system) {
    final CodeableConcept concept = new CodeableConcept();
    final Coding coding = concept.addCoding();
    if ("LN".equalsIgnoreCase(system) || "LOINC".equalsIgnoreCase(system)) {
      coding.setSystem(LOINC_SYSTEM);
    } else if (system != null) {
      coding.setSystem("urn:medflow:coding:" + system);
    }
    coding.setCode(code);
    coding.setDisplay(display);
    if (display != null) {
      concept.setText(display);
    }
    return concept;
  }

  private String firstObservationValue(final OBX obx) throws HL7Exception {
    if (obx.getObservationValueReps() == 0) {
      return null;
    }
    final var data = obx.getObservationValue(0).getData();
    return data != null ? value(data.encode()) : null;
  }

  private Observation.ObservationStatus mapStatus(final String status) {
    if (status == null) {
      return Observation.ObservationStatus.UNKNOWN;
    }
    return switch (status.toUpperCase()) {
      case "F" -> Observation.ObservationStatus.FINAL;
      case "P" -> Observation.ObservationStatus.PRELIMINARY;
      case "C" -> Observation.ObservationStatus.CORRECTED;
      case "X" -> Observation.ObservationStatus.CANCELLED;
      default -> Observation.ObservationStatus.UNKNOWN;
    };
  }

  private Double tryParseDouble(final String raw) {
    try {
      return Double.valueOf(raw.trim());
    } catch (final NumberFormatException ex) {
      return null;
    }
  }

  private String value(final String raw) {
    return raw == null || raw.isBlank() ? null : raw;
  }
}

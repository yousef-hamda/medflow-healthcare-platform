package com.medflow.hl7ingester.mapping;

import ca.uhn.hl7v2.HL7Exception;
import ca.uhn.hl7v2.model.v25.datatype.CX;
import ca.uhn.hl7v2.model.v25.datatype.XAD;
import ca.uhn.hl7v2.model.v25.datatype.XPN;
import ca.uhn.hl7v2.model.v25.message.ADT_A01;
import ca.uhn.hl7v2.model.v25.segment.PID;
import ca.uhn.hl7v2.model.v25.segment.PV1;
import java.util.ArrayList;
import java.util.List;
import org.hl7.fhir.r4.model.Encounter;
import org.hl7.fhir.r4.model.Enumerations.AdministrativeGender;
import org.hl7.fhir.r4.model.HumanName;
import org.hl7.fhir.r4.model.Patient;
import org.hl7.fhir.r4.model.Reference;
import org.springframework.stereotype.Component;

/**
 * Maps HL7v2 ADT messages to FHIR R4 {@link Patient} (from PID) and {@link Encounter} (from PV1).
 *
 * <p>The ADT_A01 v2.5 structure is reused for all ADT trigger events (A01/A02/A03/A08) because the
 * PID/PV1 segment layout is identical across them.
 */
@Component
public class AdtToFhirMapper {

  private static final String MRN_SYSTEM = "urn:medflow:mrn";
  private static final String VISIT_SYSTEM = "urn:medflow:visit-number";

  /**
   * Maps the PID segment of an ADT message to a FHIR {@link Patient}.
   *
   * @param adt the parsed ADT message
   * @return the mapped Patient resource
   * @throws HL7Exception if required fields cannot be read
   */
  public Patient toPatient(final ADT_A01 adt) throws HL7Exception {
    final PID pid = adt.getPID();
    final Patient patient = new Patient();

    for (final CX cx : pid.getPatientIdentifierList()) {
      final String value = cx.getIDNumber().getValue();
      if (value != null && !value.isBlank()) {
        patient.addIdentifier().setSystem(MRN_SYSTEM).setValue(value);
      }
    }

    for (final XPN xpn : pid.getPatientName()) {
      final HumanName name = patient.addName().setUse(HumanName.NameUse.OFFICIAL);
      if (xpn.getFamilyName() != null && xpn.getFamilyName().getSurname() != null) {
        name.setFamily(xpn.getFamilyName().getSurname().getValue());
      }
      if (xpn.getGivenName() != null && xpn.getGivenName().getValue() != null) {
        name.addGiven(xpn.getGivenName().getValue());
      }
    }

    patient.setGender(mapGender(value(pid.getAdministrativeSex().getValue())));

    final String dob = value(pid.getDateTimeOfBirth().getTime().getValue());
    if (dob != null && dob.length() >= 8) {
      patient.getBirthDateElement().setValueAsString(formatDate(dob));
    }

    for (final XAD xad : pid.getPatientAddress()) {
      final var address = patient.addAddress();
      if (xad.getStreetAddress() != null
          && xad.getStreetAddress().getStreetOrMailingAddress() != null) {
        address.addLine(xad.getStreetAddress().getStreetOrMailingAddress().getValue());
      }
      address.setCity(value(xad.getCity().getValue()));
      address.setState(value(xad.getStateOrProvince().getValue()));
      address.setPostalCode(value(xad.getZipOrPostalCode().getValue()));
    }

    return patient;
  }

  /**
   * Maps the PV1 segment of an ADT message to a FHIR {@link Encounter}.
   *
   * @param adt        the parsed ADT message
   * @param patientRef a reference to the associated Patient (may be {@code null})
   * @return the mapped Encounter resource
   * @throws HL7Exception if required fields cannot be read
   */
  public Encounter toEncounter(final ADT_A01 adt, final Reference patientRef) throws HL7Exception {
    final PV1 pv1 = adt.getPV1();
    final Encounter encounter = new Encounter();

    final String visitNumber = value(pv1.getVisitNumber().getIDNumber().getValue());
    if (visitNumber != null) {
      encounter.addIdentifier().setSystem(VISIT_SYSTEM).setValue(visitNumber);
    }

    encounter.setStatus(mapEncounterStatus(adt.getMSH().getMessageType().getTriggerEvent()
        .getValue()));
    encounter.getClass_()
        .setSystem("http://terminology.hl7.org/CodeSystem/v3-ActCode")
        .setCode(mapPatientClass(value(pv1.getPatientClass().getValue())));

    if (patientRef != null) {
      encounter.setSubject(patientRef);
    }
    return encounter;
  }

  /**
   * Maps the supported ADT trigger events handled by this mapper.
   *
   * @return the list of supported trigger events
   */
  public List<String> supportedTriggers() {
    final List<String> triggers = new ArrayList<>();
    triggers.add("A01");
    triggers.add("A02");
    triggers.add("A03");
    triggers.add("A08");
    return triggers;
  }

  private AdministrativeGender mapGender(final String sex) {
    if (sex == null) {
      return AdministrativeGender.UNKNOWN;
    }
    return switch (sex.toUpperCase()) {
      case "M" -> AdministrativeGender.MALE;
      case "F" -> AdministrativeGender.FEMALE;
      case "O" -> AdministrativeGender.OTHER;
      default -> AdministrativeGender.UNKNOWN;
    };
  }

  private Encounter.EncounterStatus mapEncounterStatus(final String triggerEvent) {
    if (triggerEvent == null) {
      return Encounter.EncounterStatus.UNKNOWN;
    }
    return switch (triggerEvent) {
      case "A01" -> Encounter.EncounterStatus.INPROGRESS;
      case "A02", "A08" -> Encounter.EncounterStatus.INPROGRESS;
      case "A03" -> Encounter.EncounterStatus.FINISHED;
      default -> Encounter.EncounterStatus.UNKNOWN;
    };
  }

  private String mapPatientClass(final String patientClass) {
    if (patientClass == null) {
      return "AMB";
    }
    return switch (patientClass.toUpperCase()) {
      case "I" -> "IMP";
      case "E" -> "EMER";
      case "O" -> "AMB";
      default -> "AMB";
    };
  }

  private String formatDate(final String hl7Date) {
    return hl7Date.substring(0, 4) + "-" + hl7Date.substring(4, 6) + "-" + hl7Date.substring(6, 8);
  }

  private String value(final String raw) {
    return raw == null || raw.isBlank() ? null : raw;
  }
}

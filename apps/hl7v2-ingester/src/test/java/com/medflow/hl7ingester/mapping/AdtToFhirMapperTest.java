package com.medflow.hl7ingester.mapping;

import static org.assertj.core.api.Assertions.assertThat;

import ca.uhn.hl7v2.DefaultHapiContext;
import ca.uhn.hl7v2.HapiContext;
import ca.uhn.hl7v2.model.v25.message.ADT_A01;
import com.medflow.hl7ingester.TestMessages;
import org.hl7.fhir.r4.model.Encounter;
import org.hl7.fhir.r4.model.Enumerations.AdministrativeGender;
import org.hl7.fhir.r4.model.Patient;
import org.hl7.fhir.r4.model.Reference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Unit tests for {@link AdtToFhirMapper} using synthetic ADT v2.5 messages.
 */
class AdtToFhirMapperTest {

  private HapiContext hapiContext;
  private AdtToFhirMapper mapper;

  @BeforeEach
  void setUp() {
    hapiContext = new DefaultHapiContext();
    mapper = new AdtToFhirMapper();
  }

  @Test
  void mapsPidToPatient() throws Exception {
    final ADT_A01 adt = (ADT_A01) hapiContext.getPipeParser().parse(TestMessages.ADT_A01);

    final Patient patient = mapper.toPatient(adt);

    assertThat(patient.getIdentifierFirstRep().getSystem()).isEqualTo("urn:medflow:mrn");
    assertThat(patient.getIdentifierFirstRep().getValue()).isEqualTo("MRN123456");
    assertThat(patient.getNameFirstRep().getFamily()).isEqualTo("SYNTHEA");
    assertThat(patient.getNameFirstRep().getGivenAsSingleString()).isEqualTo("TEST");
    assertThat(patient.getGender()).isEqualTo(AdministrativeGender.MALE);
    assertThat(patient.getBirthDateElement().getValueAsString()).isEqualTo("1985-02-14");
    assertThat(patient.getAddressFirstRep().getCity()).isEqualTo("TESTVILLE");
    assertThat(patient.getAddressFirstRep().getPostalCode()).isEqualTo("90210");
  }

  @Test
  void mapsPv1ToEncounterInProgressForAdmit() throws Exception {
    final ADT_A01 adt = (ADT_A01) hapiContext.getPipeParser().parse(TestMessages.ADT_A01);

    final Encounter encounter = mapper.toEncounter(adt, new Reference("Patient/p1"));

    assertThat(encounter.getStatus()).isEqualTo(Encounter.EncounterStatus.INPROGRESS);
    assertThat(encounter.getClass_().getCode()).isEqualTo("IMP");
    assertThat(encounter.getIdentifierFirstRep().getValue()).isEqualTo("V0001234");
    assertThat(encounter.getSubject().getReference()).isEqualTo("Patient/p1");
  }

  @Test
  void dischargeMapsToFinishedEncounter() throws Exception {
    final ADT_A01 adt = (ADT_A01) hapiContext.getPipeParser().parse(TestMessages.ADT_A03);

    final Encounter encounter = mapper.toEncounter(adt, null);

    assertThat(encounter.getStatus()).isEqualTo(Encounter.EncounterStatus.FINISHED);
  }
}

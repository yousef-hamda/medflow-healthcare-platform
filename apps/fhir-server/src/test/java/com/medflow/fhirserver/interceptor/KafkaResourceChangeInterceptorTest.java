package com.medflow.fhirserver.interceptor;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;

import ca.uhn.fhir.context.FhirContext;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.hl7.fhir.r4.model.HumanName;
import org.hl7.fhir.r4.model.Patient;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;
import org.springframework.kafka.core.KafkaTemplate;

/**
 * Unit tests for {@link KafkaResourceChangeInterceptor} verifying change-event envelope mapping.
 */
class KafkaResourceChangeInterceptorTest {

  @Mock
  private KafkaTemplate<String, String> kafkaTemplate;

  private FhirContext fhirContext;
  private ObjectMapper objectMapper;
  private KafkaResourceChangeInterceptor interceptor;
  private AutoCloseable mocks;

  @BeforeEach
  void setUp() {
    mocks = MockitoAnnotations.openMocks(this);
    fhirContext = FhirContext.forR4();
    objectMapper = new ObjectMapper();
    interceptor =
        new KafkaResourceChangeInterceptor(kafkaTemplate, fhirContext, objectMapper, "fhir.changes");
  }

  @Test
  void publishesEnvelopeWithTypeIdVersionAndOperation() throws Exception {
    final Patient patient = new Patient();
    patient.setId("Patient/abc/_history/3");
    patient.addName(new HumanName().setFamily("SYNTHEA").addGiven("TEST"));

    interceptor.publish(patient, "CREATE");

    final ArgumentCaptor<String> keyCaptor = ArgumentCaptor.forClass(String.class);
    final ArgumentCaptor<String> valueCaptor = ArgumentCaptor.forClass(String.class);
    verify(kafkaTemplate).send(eq("fhir.changes"), keyCaptor.capture(), valueCaptor.capture());

    assertThat(keyCaptor.getValue()).isEqualTo("Patient/abc");

    final JsonNode envelope = objectMapper.readTree(valueCaptor.getValue());
    assertThat(envelope.get("resourceType").asText()).isEqualTo("Patient");
    assertThat(envelope.get("resourceId").asText()).isEqualTo("abc");
    assertThat(envelope.get("versionId").asText()).isEqualTo("3");
    assertThat(envelope.get("operation").asText()).isEqualTo("CREATE");
    assertThat(envelope.get("timestamp").asText()).isNotBlank();
    assertThat(envelope.get("resource").get("resourceType").asText()).isEqualTo("Patient");
  }

  @Test
  void deleteOperationIsPropagated() {
    final Patient patient = new Patient();
    patient.setId("Patient/xyz");

    interceptor.resourceDeleted(patient);

    verify(kafkaTemplate).send(eq("fhir.changes"), eq("Patient/xyz"), org.mockito.ArgumentMatchers.contains("\"operation\":\"DELETE\""));
  }

  @org.junit.jupiter.api.AfterEach
  void tearDown() throws Exception {
    mocks.close();
  }
}

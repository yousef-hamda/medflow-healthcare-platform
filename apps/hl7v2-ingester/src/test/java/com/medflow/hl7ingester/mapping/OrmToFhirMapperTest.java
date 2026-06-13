package com.medflow.hl7ingester.mapping;

import static org.assertj.core.api.Assertions.assertThat;

import ca.uhn.hl7v2.DefaultHapiContext;
import ca.uhn.hl7v2.HapiContext;
import ca.uhn.hl7v2.model.v25.message.ORM_O01;
import com.medflow.hl7ingester.TestMessages;
import java.util.List;
import org.hl7.fhir.r4.model.Reference;
import org.hl7.fhir.r4.model.ServiceRequest;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

/**
 * Unit tests for {@link OrmToFhirMapper} using a synthetic ORM^O01 v2.5 message.
 */
class OrmToFhirMapperTest {

  private HapiContext hapiContext;
  private OrmToFhirMapper mapper;

  @BeforeEach
  void setUp() {
    hapiContext = new DefaultHapiContext();
    mapper = new OrmToFhirMapper();
  }

  @Test
  void mapsOrcAndObrToServiceRequest() throws Exception {
    final ORM_O01 orm = (ORM_O01) hapiContext.getPipeParser().parse(TestMessages.ORM_O01);

    final List<ServiceRequest> requests = mapper.toServiceRequests(orm, new Reference("Patient/p1"));

    assertThat(requests).hasSize(1);
    final ServiceRequest request = requests.get(0);
    assertThat(request.getStatus()).isEqualTo(ServiceRequest.ServiceRequestStatus.ACTIVE);
    assertThat(request.getIntent()).isEqualTo(ServiceRequest.ServiceRequestIntent.ORDER);
    assertThat(request.getIdentifierFirstRep().getValue()).isEqualTo("PLACER555");
    assertThat(request.getCode().getCodingFirstRep().getSystem()).isEqualTo("http://loinc.org");
    assertThat(request.getCode().getCodingFirstRep().getCode()).isEqualTo("24323-8");
    assertThat(request.getSubject().getReference()).isEqualTo("Patient/p1");
  }
}

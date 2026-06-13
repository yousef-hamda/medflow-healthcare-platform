package com.medflow.fhirserver.interceptor;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.Mockito.when;

import ca.uhn.fhir.rest.api.RestOperationTypeEnum;
import ca.uhn.fhir.rest.api.server.RequestDetails;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.Mock;
import org.mockito.MockitoAnnotations;
import org.springframework.web.reactive.function.client.WebClient;

/**
 * Unit tests for {@link AuditEventInterceptor} verifying graceful degradation.
 */
class AuditEventInterceptorTest {

  @Mock
  private RequestDetails requestDetails;

  private AuditEventInterceptor interceptor;
  private AutoCloseable mocks;

  @BeforeEach
  void setUp() {
    mocks = MockitoAnnotations.openMocks(this);
    // Point at an unroutable host so the async POST fails; the interceptor must not throw.
    interceptor = new AuditEventInterceptor(
        WebClient.builder().build(),
        new ObjectMapper(),
        "http://audit-service-does-not-exist.invalid:8095");
  }

  @Test
  void auditFailureDoesNotPropagate() {
    when(requestDetails.getResourceName()).thenReturn("Patient");
    when(requestDetails.getId()).thenReturn(null);
    when(requestDetails.getRestOperationType()).thenReturn(RestOperationTypeEnum.READ);

    // Audit-service unavailability must degrade gracefully (no exception bubbles up).
    assertThatCode(() -> interceptor.sendAuditEvent(requestDetails)).doesNotThrowAnyException();
  }

  @Test
  void nullRequestDetailsAreIgnored() {
    assertThatCode(() -> interceptor.recordAuditEvent(null)).doesNotThrowAnyException();
  }

  @AfterEach
  void tearDown() throws Exception {
    mocks.close();
  }
}

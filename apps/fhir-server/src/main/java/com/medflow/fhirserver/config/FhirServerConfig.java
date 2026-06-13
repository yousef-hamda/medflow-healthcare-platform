package com.medflow.fhirserver.config;

import ca.uhn.fhir.context.FhirContext;
import ca.uhn.fhir.jpa.provider.JpaSystemProvider;
import ca.uhn.fhir.rest.server.IResourceProvider;
import ca.uhn.fhir.rest.server.RestfulServer;
import ca.uhn.fhir.rest.server.provider.ResourceProviderFactory;
import com.medflow.fhirserver.interceptor.AuditEventInterceptor;
import com.medflow.fhirserver.interceptor.KafkaResourceChangeInterceptor;
import jakarta.servlet.ServletException;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.web.servlet.ServletRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Wires the HAPI FHIR {@link RestfulServer} into the Spring Boot application.
 *
 * <p>Registers the FHIR REST servlet at {@code /fhir/*} together with the JPA resource providers
 * for the supported R4 resource types and the MedFlow interceptors that publish change events to
 * Kafka and forward audit events to the audit service.
 */
@Configuration
public class FhirServerConfig {

  /** Resource types exposed by this server. */
  private static final Set<String> SUPPORTED_RESOURCES = Set.of(
      "Patient",
      "Encounter",
      "Observation",
      "Condition",
      "MedicationRequest",
      "DiagnosticReport",
      "ImagingStudy",
      "DocumentReference");

  /**
   * Registers the HAPI {@link RestfulServer} servlet at {@code /fhir/*}.
   *
   * @param fhirContext                     the R4 {@link FhirContext}
   * @param resourceProviderFactory         HAPI factory exposing all generated R4 JPA providers
   * @param systemProvider                  the JPA system provider for system-level operations
   * @param kafkaResourceChangeInterceptor  interceptor publishing change events to Kafka
   * @param auditEventInterceptor           interceptor forwarding audit events
   * @return the servlet registration bean for the FHIR REST API
   */
  @Bean
  public ServletRegistrationBean<RestfulServer> fhirServletRegistration(
      final FhirContext fhirContext,
      @Qualifier("myResourceProvidersR4") final ResourceProviderFactory resourceProviderFactory,
      @Qualifier("mySystemProviderR4") final JpaSystemProvider<?, ?> systemProvider,
      final KafkaResourceChangeInterceptor kafkaResourceChangeInterceptor,
      final AuditEventInterceptor auditEventInterceptor) {

    final RestfulServer restfulServer = new RestfulServer(fhirContext) {
      private static final long serialVersionUID = 1L;

      @Override
      protected void initialize() throws ServletException {
        super.initialize();

        // Restrict the exposed API to the supported MedFlow resource types.
        final List<IResourceProvider> providers =
            resourceProviderFactory.createProviders().stream()
                .filter(IResourceProvider.class::isInstance)
                .map(IResourceProvider.class::cast)
                .filter(provider ->
                    SUPPORTED_RESOURCES.contains(
                        getFhirContext().getResourceType(provider.getResourceType())))
                .collect(Collectors.toList());
        setResourceProviders(providers);

        setPlainProviders(systemProvider);

        registerInterceptor(kafkaResourceChangeInterceptor);
        registerInterceptor(auditEventInterceptor);
      }
    };

    final ServletRegistrationBean<RestfulServer> registration =
        new ServletRegistrationBean<>(restfulServer, "/fhir/*");
    registration.setName("FhirServlet");
    registration.setLoadOnStartup(1);
    return registration;
  }
}

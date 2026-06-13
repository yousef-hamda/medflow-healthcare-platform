package com.medflow.fhirserver.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.reactive.function.client.WebClient;

/**
 * Provides the reactive {@link WebClient} used to call the audit service asynchronously.
 */
@Configuration
public class WebClientConfig {

  /**
   * Builds a shared {@link WebClient} bean.
   *
   * @param builder the auto-configured WebClient builder
   * @return a reusable WebClient instance
   */
  @Bean
  public WebClient auditWebClient(final WebClient.Builder builder) {
    return builder.build();
  }
}

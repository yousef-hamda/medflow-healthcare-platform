package com.medflow.fhirserver.controller;

import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * Exposes the SMART-on-FHIR discovery document.
 *
 * <p>Serves {@code GET /.well-known/smart-configuration} describing the authorization and token
 * endpoints together with the SMART capabilities, scopes and PKCE methods supported by the MedFlow
 * deployment.
 */
@RestController
public class SmartConfigurationController {

  private static final String AUTHORIZATION_ENDPOINT = "http://localhost:4000/oauth/authorize";
  private static final String TOKEN_ENDPOINT = "http://localhost:4000/oauth/token";

  private static final List<String> CAPABILITIES = List.of(
      "launch-standalone",
      "client-public",
      "client-confidential-symmetric",
      "context-standalone-patient",
      "permission-patient",
      "permission-user");

  private static final List<String> SCOPES_SUPPORTED = List.of(
      "openid",
      "fhirUser",
      "launch",
      "launch/patient",
      "offline_access",
      "patient/*.read",
      "user/*.read",
      "patient/*.rs",
      "user/*.rs");

  private static final List<String> CODE_CHALLENGE_METHODS = List.of("S256");

  private static final List<String> GRANT_TYPES = List.of("authorization_code", "client_credentials");

  private static final List<String> RESPONSE_TYPES = List.of("code");

  private static final List<String> TOKEN_AUTH_METHODS =
      List.of("client_secret_basic", "client_secret_post", "private_key_jwt");

  /**
   * Returns the SMART configuration discovery document.
   *
   * @return a map serialized to the well-known SMART configuration JSON
   */
  @GetMapping(value = "/.well-known/smart-configuration", produces = "application/json")
  public Map<String, Object> smartConfiguration() {
    return Map.of(
        "authorization_endpoint", AUTHORIZATION_ENDPOINT,
        "token_endpoint", TOKEN_ENDPOINT,
        "capabilities", CAPABILITIES,
        "scopes_supported", SCOPES_SUPPORTED,
        "code_challenge_methods_supported", CODE_CHALLENGE_METHODS,
        "grant_types_supported", GRANT_TYPES,
        "response_types_supported", RESPONSE_TYPES,
        "token_endpoint_auth_methods_supported", TOKEN_AUTH_METHODS);
  }
}

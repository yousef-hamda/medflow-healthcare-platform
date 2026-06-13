package com.medflow.fhirserver.controller;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.test.web.servlet.MockMvc;

/**
 * MockMvc tests for {@link SmartConfigurationController} verifying the discovery payload.
 */
@WebMvcTest(SmartConfigurationController.class)
class SmartConfigurationControllerTest {

  @Autowired
  private MockMvc mockMvc;

  @Test
  void returnsSmartConfigurationPayload() throws Exception {
    mockMvc.perform(get("/.well-known/smart-configuration"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.authorization_endpoint")
            .value("http://localhost:4000/oauth/authorize"))
        .andExpect(jsonPath("$.token_endpoint").value("http://localhost:4000/oauth/token"))
        .andExpect(jsonPath("$.code_challenge_methods_supported[0]").value("S256"))
        .andExpect(jsonPath("$.capabilities", org.hamcrest.Matchers.hasItems(
            "launch-standalone",
            "client-public",
            "client-confidential-symmetric",
            "context-standalone-patient",
            "permission-patient",
            "permission-user")))
        .andExpect(jsonPath("$.scopes_supported", org.hamcrest.Matchers.hasItem("patient/*.read")));
  }
}

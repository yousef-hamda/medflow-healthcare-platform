package com.medflow.hl7ingester.mllp;

import ca.uhn.hl7v2.HapiContext;
import ca.uhn.hl7v2.app.HL7Service;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * Starts and stops the HAPI MLLP {@link HL7Service} (SimpleServer) that accepts inbound HL7v2
 * messages over the configured {@code MLLP_PORT}.
 *
 * <p>Handlers are registered per message type: ADT (A01/A02/A03/A08), ORU^R01 and ORM^O01. Each
 * handler returns an application ACK (AA) on success or NAK (AE) on failure.
 */
@Component
public class MllpServer {

  private static final Logger LOG = LoggerFactory.getLogger(MllpServer.class);

  private final HapiContext hapiContext;
  private final int mllpPort;
  private final AdtMessageHandler adtHandler;
  private final OruMessageHandler oruHandler;
  private final OrmMessageHandler ormHandler;

  private HL7Service service;

  /**
   * Creates the server.
   *
   * @param hapiContext the shared HL7v2 context
   * @param mllpPort    the MLLP listen port (from {@code MLLP_PORT})
   * @param adtHandler  the ADT handler
   * @param oruHandler  the ORU handler
   * @param ormHandler  the ORM handler
   */
  public MllpServer(
      final HapiContext hapiContext,
      @Value("${mllp.port}") final int mllpPort,
      final AdtMessageHandler adtHandler,
      final OruMessageHandler oruHandler,
      final OrmMessageHandler ormHandler) {
    this.hapiContext = hapiContext;
    this.mllpPort = mllpPort;
    this.adtHandler = adtHandler;
    this.oruHandler = oruHandler;
    this.ormHandler = ormHandler;
  }

  /**
   * Starts the MLLP server once the Spring application is ready.
   *
   * @throws InterruptedException if interrupted while waiting for the service to start
   */
  @EventListener(ApplicationReadyEvent.class)
  public void start() throws InterruptedException {
    service = hapiContext.newServer(mllpPort, false);
    registerHandlers(service);
    service.startAndWait();
    LOG.info("MLLP server listening on port={}", mllpPort);
  }

  /**
   * Registers the per-message-type handlers on the supplied service. Visible for testing.
   *
   * @param target the HL7 service to configure
   */
  void registerHandlers(final HL7Service target) {
    // ADT trigger events sharing the ADT handler.
    for (final String trigger : new String[] {"A01", "A02", "A03", "A08"}) {
      target.registerApplication("ADT", trigger, adtHandler);
    }
    target.registerApplication("ORU", "R01", oruHandler);
    target.registerApplication("ORM", "O01", ormHandler);
  }

  /**
   * Stops the MLLP server on shutdown.
   */
  @PreDestroy
  public void stop() {
    if (service != null) {
      service.stopAndWait();
      LOG.info("MLLP server stopped port={}", mllpPort);
    }
  }
}

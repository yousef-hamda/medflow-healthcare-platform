package com.medflow.hl7ingester.parser;

import ca.uhn.hl7v2.HL7Exception;
import ca.uhn.hl7v2.HapiContext;
import ca.uhn.hl7v2.model.Message;
import ca.uhn.hl7v2.parser.PipeParser;
import org.springframework.stereotype.Component;

/**
 * Parses raw HL7v2 pipe-delimited messages into the HAPI object model.
 *
 * <p>Wraps a HAPI {@link PipeParser} configured from the shared {@link HapiContext}. Parse failures
 * surface as {@link HL7Exception}, allowing callers to route messages to the dead-letter path.
 */
@Component
public class Hl7MessageParser {

  private final PipeParser pipeParser;

  /**
   * Creates the parser.
   *
   * @param hapiContext the shared HL7v2 context
   */
  public Hl7MessageParser(final HapiContext hapiContext) {
    this.pipeParser = hapiContext.getPipeParser();
  }

  /**
   * Parses a raw HL7v2 message.
   *
   * @param raw the verbatim pipe-delimited HL7v2 message
   * @return the parsed HAPI {@link Message}
   * @throws HL7Exception if the message is malformed or cannot be parsed
   */
  public Message parse(final String raw) throws HL7Exception {
    return pipeParser.parse(raw);
  }
}

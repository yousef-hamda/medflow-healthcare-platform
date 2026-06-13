import { HttpStatus } from '@nestjs/common';
import type {
  IssueSeverity,
  OperationOutcome,
} from '@medflow/fhir-types';

/** FHIR issue type codes used by the proxy for non-2xx responses. */
type IssueCode =
  | 'forbidden'
  | 'security'
  | 'not-found'
  | 'invalid'
  | 'processing'
  | 'transient'
  | 'exception';

export function operationOutcome(
  severity: IssueSeverity,
  code: IssueCode,
  diagnostics: string,
): OperationOutcome {
  return {
    resourceType: 'OperationOutcome',
    issue: [{ severity, code, diagnostics }],
  };
}

/** Maps an upstream HTTP status to a FHIR OperationOutcome issue code. */
export function statusToOutcome(
  status: number,
  diagnostics: string,
): OperationOutcome {
  let code: IssueCode = 'processing';
  if (status === HttpStatus.FORBIDDEN) code = 'forbidden';
  else if (status === HttpStatus.UNAUTHORIZED) code = 'security';
  else if (status === HttpStatus.NOT_FOUND) code = 'not-found';
  else if (status === HttpStatus.BAD_REQUEST) code = 'invalid';
  else if (status >= 500) code = 'exception';
  else if (status === HttpStatus.SERVICE_UNAVAILABLE) code = 'transient';

  const severity: IssueSeverity = status >= 500 ? 'fatal' : 'error';
  return operationOutcome(severity, code, diagnostics);
}

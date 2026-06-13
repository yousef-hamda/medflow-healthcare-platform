import { Injectable } from '@nestjs/common';
import {
  type Policy,
  type PolicyAction,
  type PolicyDecision,
  type ResourceAttributes,
  type SubjectAttributes,
} from './policy.types';
import { BUILT_IN_POLICIES } from './policies/built-in.policies';

/**
 * Pure, dependency-free policy evaluator.
 *
 * Algorithm (deny-overrides):
 *   1. Gather all policies that match the action + resource type and whose
 *      condition is true for the request.
 *   2. If any matched policy is a deny → deny.
 *   3. Else if any matched policy is an allow → allow.
 *   4. Else → default deny.
 */
@Injectable()
export class PolicyEngine {
  private readonly policies: Policy[];

  constructor(policies: Policy[] = BUILT_IN_POLICIES) {
    this.policies = policies;
  }

  private applies(
    policy: Policy,
    action: PolicyAction,
    resource: ResourceAttributes,
    subject: SubjectAttributes,
  ): boolean {
    const actionMatch =
      policy.actions.includes('*') || policy.actions.includes(action);
    const typeMatch =
      policy.resourceType === '*' ||
      policy.resourceType === resource.resourceType;
    if (!actionMatch || !typeMatch) return false;
    return policy.condition(subject, resource);
  }

  evaluate(
    subject: SubjectAttributes,
    action: PolicyAction,
    resource: ResourceAttributes,
  ): PolicyDecision {
    const matched = this.policies.filter((p) =>
      this.applies(p, action, resource, subject),
    );

    const deny = matched.find((p) => p.effect === 'deny');
    if (deny) {
      return { decision: 'deny', reason: `Denied by policy "${deny.name}"` };
    }

    const allow = matched.find((p) => p.effect === 'allow');
    if (allow) {
      const viaBreakGlass = allow.name === 'break-glass-override';
      return {
        decision: 'allow',
        reason: viaBreakGlass
          ? `Allowed via break-glass grant (policy "${allow.name}")`
          : `Allowed by policy "${allow.name}"`,
      };
    }

    return {
      decision: 'deny',
      reason: `No policy grants ${action} on ${resource.resourceType}${
        resource.patientId ? ` for patient ${resource.patientId}` : ''
      }`,
    };
  }
}

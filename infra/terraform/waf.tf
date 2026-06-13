# Regional WAFv2 Web ACL fronting the ALB: AWS managed common + known-bad-input
# rule groups, plus a rate-based rule to blunt L7 floods / brute force.

resource "aws_wafv2_web_acl" "medflow" {
  name        = "medflow-${var.env}"
  description = "MedFlow ${var.env} regional Web ACL for the ALB"
  scope       = "REGIONAL"

  default_action {
    allow {}
  }

  rule {
    name     = "AWSManagedRulesCommonRuleSet"
    priority = 1
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesCommonRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "medflow-${var.env}-common"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "AWSManagedRulesKnownBadInputsRuleSet"
    priority = 2
    override_action {
      none {}
    }
    statement {
      managed_rule_group_statement {
        name        = "AWSManagedRulesKnownBadInputsRuleSet"
        vendor_name = "AWS"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "medflow-${var.env}-bad-inputs"
      sampled_requests_enabled   = true
    }
  }

  rule {
    name     = "RateLimit"
    priority = 3
    action {
      block {}
    }
    statement {
      rate_based_statement {
        limit              = 2000
        aggregate_key_type = "IP"
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "medflow-${var.env}-rate-limit"
      sampled_requests_enabled   = true
    }
  }

  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "medflow-${var.env}-web-acl"
    sampled_requests_enabled   = true
  }

  tags = { Name = "medflow-${var.env}" }
}

# Associate with the ALB. Guarded by count so `plan` is clean before an ALB
# ARN is known (the ALB is provisioned by the in-cluster Load Balancer
# Controller, not by this stack).
resource "aws_wafv2_web_acl_association" "alb" {
  count        = var.alb_arn_for_waf == "" ? 0 : 1
  resource_arn = var.alb_arn_for_waf
  web_acl_arn  = aws_wafv2_web_acl.medflow.arn
}

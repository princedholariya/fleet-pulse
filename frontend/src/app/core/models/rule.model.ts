export type RuleMetric = 'p95' | 'errRate' | 'rps';
export type RuleOperator = '>' | '>=' | '<' | '<=';

export interface RuleCondition {
  metric: RuleMetric;
  operator: RuleOperator;
  threshold: number;
  durationSec: number;
  warningThreshold?: number; // Optional cross-field property for advanced alerts
}

export interface AlertRule {
  id?: string;
  name: string;
  conditions: RuleCondition[];
  createdAt?: number;
  updatedAt?: number;
}

export interface IncidentAlert {
  id: string;
  ruleId: string;
  ruleName: string;
  serviceId: string;
  metric: RuleMetric;
  currentValue: number;
  threshold: number;
  triggeredAt: number;
}


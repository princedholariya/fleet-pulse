import { Component, inject, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormArray, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router, ActivatedRoute, RouterModule } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { RulesService } from '../../core/services/rules.service';
import { AlertRule, RuleMetric, RuleOperator } from '../../core/models/rule.model';
import {
  warningThresholdLowerThanCriticalValidator,
  uniqueRuleNameValidator,
  metricThresholdValidator
} from '../../core/validators/rule.validators';
import { ComponentCanDeactivate } from '../../core/guards/pending-changes.guard';

@Component({
  selector: 'app-rule-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  templateUrl: './rule-form.component.html',
  styleUrls: ['./rule-form.component.scss']
})
export class RuleFormComponent implements OnInit, ComponentCanDeactivate {
  private readonly fb = inject(FormBuilder);
  private readonly rulesService = inject(RulesService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly http = inject(HttpClient);

  readonly ruleId = signal<string | null>(null);
  readonly isSaving = signal<boolean>(false);
  readonly errorMessage = signal<string | null>(null);
  private isSavedSuccessfully = false;

  readonly ruleForm = this.fb.group({
    name: ['', {
      validators: [Validators.required, Validators.minLength(3)],
      asyncValidators: [uniqueRuleNameValidator(this.http)],
      updateOn: 'blur'
    }],
    conditions: this.fb.array<FormGroup>([])
  });

  get conditionsArray(): FormArray {
    return this.ruleForm.get('conditions') as FormArray;
  }

  ngOnInit(): void {
    const id = this.route.snapshot.params['id'];
    if (id) {
      this.ruleId.set(id);
      // Re-configure async validator with excludeId
      this.ruleForm.get('name')?.setAsyncValidators([
        uniqueRuleNameValidator(this.http, id)
      ]);

      const existing = this.rulesService.rules().find(r => r.id === id);
      if (existing) {
        this.populateForm(existing);
      }
    } else {
      // Default to 1 condition
      this.addCondition();
    }
  }

  createConditionGroup(initialMetric: RuleMetric = 'p95', op = '>', thresh = 500, dur = 30, warn?: number): FormGroup {
    return this.fb.group({
      metric: [initialMetric, Validators.required],
      operator: [op, Validators.required],
      threshold: [thresh, [Validators.required, Validators.min(0)]],
      warningThreshold: [warn ?? null],
      durationSec: [dur, [Validators.required, Validators.min(1)]]
    }, {
      validators: [
        warningThresholdLowerThanCriticalValidator(),
        metricThresholdValidator()
      ]
    });
  }

  addCondition(): void {
    this.conditionsArray.push(this.createConditionGroup());
    this.ruleForm.markAsDirty();
  }

  removeCondition(index: number): void {
    if (this.conditionsArray.length > 1) {
      this.conditionsArray.removeAt(index);
      this.ruleForm.markAsDirty();
    }
  }

  populateForm(rule: AlertRule): void {
    this.ruleForm.patchValue({ name: rule.name });
    this.conditionsArray.clear();

    if (rule.conditions && rule.conditions.length > 0) {
      for (const cond of rule.conditions) {
        this.conditionsArray.push(this.createConditionGroup(
          cond.metric,
          cond.operator,
          cond.threshold,
          cond.durationSec,
          cond.warningThreshold
        ));
      }
    } else {
      this.addCondition();
    }
  }

  onSubmit(): void {
    if (this.ruleForm.invalid || this.isSaving()) {
      this.ruleForm.markAllAsTouched();
      return;
    }

    this.isSaving.set(true);
    this.errorMessage.set(null);

    const formValue = this.ruleForm.getRawValue();
    const rawConditions = (formValue.conditions || []) as Record<string, unknown>[];

    const ruleToSave: AlertRule = {
      ...(this.ruleId() ? { id: this.ruleId()! } : {}),
      name: formValue.name!,
      conditions: rawConditions.map(c => ({
        metric: c['metric'] as RuleMetric,
        operator: c['operator'] as RuleOperator,
        threshold: Number(c['threshold']),
        durationSec: Number(c['durationSec']),
        ...(c['warningThreshold'] ? { warningThreshold: Number(c['warningThreshold']) } : {})
      }))
    };

    this.rulesService.saveRuleOptimistically(ruleToSave).subscribe({
      next: () => {
        this.isSavedSuccessfully = true;
        this.isSaving.set(false);
        this.router.navigate(['/rules']);
      },
      error: (err) => {
        this.isSaving.set(false);
        const msg = err.error?.message || 'Server rejected rule save. Changes were rolled back.';
        this.errorMessage.set(msg);
      }
    });
  }

  canDeactivate(): boolean {
    if (this.isSavedSuccessfully) return true;
    return !this.ruleForm.dirty;
  }
}


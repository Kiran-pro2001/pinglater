/**
 * PingLater - Multi-Step Follow-Up Cadence Test Suite
 * Comprehensive Unit & Integration Tests
 * Runs cleanly via Node.js native test runner (`node --test`)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  CADENCE_STATUS,
  PRESET_CADENCES,
  normalizeCadencePhone,
  interpolateCadenceMessage,
  calculateStepDueDate,
  createCadenceBlueprint,
  enrollContactInCadence,
  enrollBatchInCadence,
  recordStepSent,
  recordContactReplied,
  checkDueEnrollments,
  pauseEnrollment,
  resumeEnrollment,
  cancelEnrollment,
  calculateCadenceMetrics,
  formatDelayText
} from '../utils/cadence.js';

import { StorageService, STORAGE_KEYS } from '../utils/storage.js';

describe('Multi-Step Follow-Up Cadence Engine - Unit Tests', () => {

  describe('1. Presets & Blueprint Validation', () => {
    it('should provide default high-converting preset cadences', () => {
      assert.ok(Array.isArray(PRESET_CADENCES));
      assert.strictEqual(PRESET_CADENCES.length, 3);

      const agency = PRESET_CADENCES[0];
      assert.strictEqual(agency.id, 'cadence_agency_outreach_3step');
      assert.strictEqual(agency.steps.length, 3);
      assert.strictEqual(agency.steps[0].delayDays, 0);
      assert.strictEqual(agency.steps[1].delayDays, 3);
      assert.strictEqual(agency.steps[2].delayDays, 4);
    });

    it('should create and validate a custom cadence blueprint', () => {
      const blueprint = createCadenceBlueprint({
        name: 'SaaS Demo Follow-up',
        description: 'Demo checkin sequence',
        steps: [
          { title: 'Intro', delayDays: 0, delayHours: 0, message: 'Hi {{name}}, thanks for the demo!' },
          { title: 'Case Study', delayDays: 2, delayHours: 48, message: 'Hey {{name}}, here is the case study.' }
        ]
      });

      assert.ok(blueprint.id.startsWith('cadence_'));
      assert.strictEqual(blueprint.name, 'SaaS Demo Follow-up');
      assert.strictEqual(blueprint.steps.length, 2);
      assert.strictEqual(blueprint.steps[0].stepNumber, 1);
      assert.strictEqual(blueprint.steps[1].stepNumber, 2);
      assert.strictEqual(blueprint.steps[0].condition, 'always');
      assert.strictEqual(blueprint.steps[1].condition, 'if_no_reply');
    });

    it('should throw an error if cadence name or steps are missing', () => {
      assert.throws(() => {
        createCadenceBlueprint({ name: '', steps: [{ message: 'test' }] });
      }, /must have a valid name/);

      assert.throws(() => {
        createCadenceBlueprint({ name: 'Valid Name', steps: [] });
      }, /must contain at least 1 step/);
    });
  });

  describe('2. Phone Normalization & Variable Interpolation', () => {
    it('should normalize international and local phone strings', () => {
      assert.strictEqual(normalizeCadencePhone('+91 98765-43210'), '919876543210');
      assert.strictEqual(normalizeCadencePhone('(555) 123-4567'), '5551234567');
      assert.strictEqual(normalizeCadencePhone(''), '');
      assert.strictEqual(normalizeCadencePhone(null), '');
    });

    it('should interpolate variables with case insensitivity and fallback', () => {
      const template = 'Hi {{name}}, saw your {{project}} at {{company}}! Phone: {{phone}}';
      const variables = {
        name: 'Kiran',
        project: 'PingLater',
        company: 'IndieHacker',
        phone: '+919999999999'
      };

      const out = interpolateCadenceMessage(template, variables);
      assert.strictEqual(out, 'Hi Kiran, saw your PingLater at IndieHacker! Phone: +919999999999');
    });

    it('should fallback missing name to "there" and clean missing extra vars', () => {
      const template = 'Hi {{name}}, checking on {{missing_var}}!';
      const out = interpolateCadenceMessage(template, {});
      assert.strictEqual(out, 'Hi there, checking on !');
    });
  });

  describe('3. Delay & Due Date Calculations', () => {
    it('should calculate due date from reference time', () => {
      const base = new Date('2026-11-11T12:00:00.000Z');
      const dueImmediate = calculateStepDueDate(0, 0, base);
      assert.strictEqual(dueImmediate, '2026-11-11T12:00:00.000Z');

      const due3Days = calculateStepDueDate(3, 0, base);
      assert.strictEqual(due3Days, '2026-11-14T12:00:00.000Z');

      const due2Hours = calculateStepDueDate(0, 2, base);
      assert.strictEqual(due2Hours, '2026-11-11T14:00:00.000Z');
    });

    it('should format human friendly delay descriptions', () => {
      assert.strictEqual(formatDelayText(0, 0), 'Immediately (Day 1)');
      assert.strictEqual(formatDelayText(3, 72), '3 days');
      assert.strictEqual(formatDelayText(1, 24), '1 day');
      assert.strictEqual(formatDelayText(0, 5), '5 hours');
    });
  });

  describe('4. Contact Enrollment', () => {
    it('should enroll a single contact into Step 1 immediately if delay is 0', () => {
      const cadence = PRESET_CADENCES[0];
      const contact = {
        name: 'Aarav Patel',
        phone: '+91 98765 00000',
        company: 'TechCorp',
        project: 'Landing Page'
      };

      const enrollment = enrollContactInCadence(cadence, contact, {
        enrolledAt: '2026-11-11T10:00:00.000Z'
      });

      assert.ok(enrollment.id.startsWith('enr_'));
      assert.strictEqual(enrollment.cadenceId, cadence.id);
      assert.strictEqual(enrollment.contactName, 'Aarav Patel');
      assert.strictEqual(enrollment.cleanPhone, '919876500000');
      assert.strictEqual(enrollment.currentStepIndex, 0);
      assert.strictEqual(enrollment.totalSteps, 3);
      assert.strictEqual(enrollment.status, CADENCE_STATUS.DUE); // 0 delay means due now
      assert.strictEqual(enrollment.nextStepDueAt, '2026-11-11T10:00:00.000Z');
      assert.strictEqual(enrollment.history.length, 0);
    });

    it('should enroll a batch of contacts while preventing active duplicates', () => {
      const cadence = PRESET_CADENCES[0];
      const batch = [
        { name: 'Lead 1', phone: '919800000001' },
        { name: 'Lead 2', phone: '919800000002' },
        { name: 'Lead 1 Duplicate', phone: '919800000001' } // Duplicate in batch
      ];

      const existingEnrollments = [
        { cleanPhone: '919800000099', status: CADENCE_STATUS.ACTIVE }
      ];

      const enrolled = enrollBatchInCadence(cadence, batch, existingEnrollments);
      assert.strictEqual(enrolled.length, 2); // Deduped to 2 unique contacts
      assert.strictEqual(enrolled[0].contactName, 'Lead 1');
      assert.strictEqual(enrolled[1].contactName, 'Lead 2');
    });
  });

  describe('5. Step Progression & Cadence Completion', () => {
    it('should advance from Step 1 to Step 2 with proper delay and history', () => {
      const cadence = PRESET_CADENCES[0];
      const contact = { name: 'Madan', phone: '919876543210', project: 'Zepto Warehouse' };
      const enr = enrollContactInCadence(cadence, contact, { enrolledAt: '2026-11-11T10:00:00.000Z' });

      // Send Step 1
      const sendTime1 = '2026-11-11T10:05:00.000Z';
      const enrStep2 = recordStepSent(enr, cadence, { sentAt: sendTime1 });

      assert.strictEqual(enrStep2.currentStepIndex, 1);
      assert.strictEqual(enrStep2.status, CADENCE_STATUS.AWAITING_REPLY);
      assert.strictEqual(enrStep2.history.length, 1);
      assert.strictEqual(enrStep2.history[0].stepNumber, 1);
      assert.strictEqual(enrStep2.history[0].status, 'sent');
      assert.ok(enrStep2.history[0].message.includes('Zepto Warehouse'));

      // Step 2 delay is 3 days -> due 2026-11-14T10:05:00.000Z
      assert.strictEqual(enrStep2.nextStepDueAt, '2026-11-14T10:05:00.000Z');

      // Send Step 2 (3 days later)
      const sendTime2 = '2026-11-14T10:10:00.000Z';
      const enrStep3 = recordStepSent(enrStep2, cadence, { sentAt: sendTime2 });

      assert.strictEqual(enrStep3.currentStepIndex, 2);
      assert.strictEqual(enrStep3.status, CADENCE_STATUS.AWAITING_REPLY);
      assert.strictEqual(enrStep3.history.length, 2);
      // Step 3 delay is 4 days -> due 2026-11-18T10:10:00.000Z
      assert.strictEqual(enrStep3.nextStepDueAt, '2026-11-18T10:10:00.000Z');

      // Send Step 3 (Final Break-up step)
      const sendTime3 = '2026-11-18T11:00:00.000Z';
      const enrCompleted = recordStepSent(enrStep3, cadence, { sentAt: sendTime3 });

      assert.strictEqual(enrCompleted.status, CADENCE_STATUS.COMPLETED);
      assert.strictEqual(enrCompleted.history.length, 3);
      assert.strictEqual(enrCompleted.nextStepDueAt, null);
      assert.strictEqual(enrCompleted.completedAt, sendTime3);
    });
  });

  describe('6. Automatic Stop-on-Reply State Machine', () => {
    it('should immediately halt the cadence when contact replies', () => {
      const cadence = PRESET_CADENCES[0];
      const enr = enrollContactInCadence(cadence, { name: 'Priya', phone: '919888877777' });
      const activeEnr = recordStepSent(enr, cadence, { sentAt: '2026-11-11T10:00:00.000Z' });

      assert.strictEqual(activeEnr.status, CADENCE_STATUS.AWAITING_REPLY);

      // Contact replies!
      const replyTime = '2026-11-12T14:30:00.000Z';
      const halted = recordContactReplied(activeEnr, replyTime);

      assert.strictEqual(halted.status, CADENCE_STATUS.REPLIED);
      assert.strictEqual(halted.repliedAt, replyTime);
      assert.strictEqual(halted.nextStepDueAt, null); // Alarms cleared!
    });

    it('should throw an error if attempting to send follow-up to a replied contact', () => {
      const cadence = PRESET_CADENCES[0];
      const enr = enrollContactInCadence(cadence, { name: 'Priya', phone: '919888877777' });
      const repliedEnr = recordContactReplied(enr, '2026-11-11T12:00:00.000Z');

      assert.throws(() => {
        recordStepSent(repliedEnr, cadence);
      }, /Contact has already replied! Cadence is permanently halted/);
    });
  });

  describe('7. Due Follow-Ups Evaluation', () => {
    it('should identify when a scheduled step becomes due', () => {
      const cadence = PRESET_CADENCES[0];
      const enr = enrollContactInCadence(cadence, { name: 'Vikram', phone: '919777766666' });
      const waitingEnr = recordStepSent(enr, cadence, { sentAt: '2026-11-11T10:00:00.000Z' });
      // nextStepDueAt is 2026-11-14T10:00:00.000Z (3 days later)

      // Test before due date
      const checkBefore = checkDueEnrollments([waitingEnr], '2026-11-13T10:00:00.000Z');
      assert.strictEqual(checkBefore.dueItems.length, 0);

      // Test on/after due date
      const checkAfter = checkDueEnrollments([waitingEnr], '2026-11-14T10:01:00.000Z');
      assert.strictEqual(checkAfter.dueItems.length, 1);
      assert.strictEqual(checkAfter.dueItems[0].status, CADENCE_STATUS.DUE);
    });
  });

  describe('8. Pause, Resume, and Cancel Actions', () => {
    it('should pause and resume an enrollment correctly', () => {
      const cadence = PRESET_CADENCES[0];
      const enr = enrollContactInCadence(cadence, { name: 'Deepak', phone: '919666655555' });
      enr.nextStepDueAt = '2026-11-15T10:00:00.000Z';

      const paused = pauseEnrollment(enr);
      assert.strictEqual(paused.status, CADENCE_STATUS.PAUSED);
      assert.ok(paused.pausedAt);

      const resumed = resumeEnrollment(paused, '2026-11-14T10:00:00.000Z');
      assert.strictEqual(resumed.status, CADENCE_STATUS.AWAITING_REPLY);

      const resumedDue = resumeEnrollment(paused, '2026-11-16T10:00:00.000Z');
      assert.strictEqual(resumedDue.status, CADENCE_STATUS.DUE);
    });

    it('should cancel an enrollment and clear nextStepDueAt', () => {
      const cadence = PRESET_CADENCES[0];
      const enr = enrollContactInCadence(cadence, { name: 'Sonia', phone: '919555544444' });
      const cancelled = cancelEnrollment(enr);
      assert.strictEqual(cancelled.status, CADENCE_STATUS.CANCELLED);
      assert.strictEqual(cancelled.nextStepDueAt, null);
    });
  });

  describe('9. Analytics & Metrics', () => {
    it('should compute accurate metrics and reply rate %', () => {
      const enrollments = [
        { status: CADENCE_STATUS.DUE },
        { status: CADENCE_STATUS.AWAITING_REPLY },
        { status: CADENCE_STATUS.REPLIED },
        { status: CADENCE_STATUS.REPLIED },
        { status: CADENCE_STATUS.COMPLETED }
      ];

      const metrics = calculateCadenceMetrics(enrollments);
      assert.strictEqual(metrics.total, 5);
      assert.strictEqual(metrics.due, 1);
      assert.strictEqual(metrics.active, 1);
      assert.strictEqual(metrics.replied, 2);
      assert.strictEqual(metrics.completed, 1);
      // 2 replied out of 5 total = 40%
      assert.strictEqual(metrics.replyRatePct, 40);
    });
  });
});

describe('Multi-Step Follow-Up Cadence Engine - Storage Integration Tests', () => {
  beforeEach(async () => {
    await StorageService.clearAllData();
  });

  it('should seed preset blueprints if storage is empty', async () => {
    const blueprints = await StorageService.getCadenceBlueprints();
    assert.ok(Array.isArray(blueprints));
    assert.strictEqual(blueprints.length, 3);
  });

  it('should save, retrieve, and delete a custom cadence blueprint', async () => {
    const newCadence = createCadenceBlueprint({
      name: 'Custom Partner Cadence',
      steps: [
        { title: 'Intro', delayDays: 0, message: 'Hello partner!' },
        { title: 'Follow-up', delayDays: 2, message: 'Any thoughts?' }
      ]
    });

    await StorageService.saveCadenceBlueprint(newCadence);
    const list = await StorageService.getCadenceBlueprints();
    assert.strictEqual(list.length, 4);
    assert.ok(list.some((c) => c.name === 'Custom Partner Cadence'));

    await StorageService.deleteCadenceBlueprint(newCadence.id);
    const listAfter = await StorageService.getCadenceBlueprints();
    assert.strictEqual(listAfter.length, 3);
  });

  it('should batch enroll contacts, persist, and record contact replies via phone match', async () => {
    const blueprints = await StorageService.getCadenceBlueprints();
    const agencyCadence = blueprints[0];

    const leads = [
      { name: 'Lead Alpha', phone: '+91 99000-11111', project: 'App Dev' },
      { name: 'Lead Beta', phone: '+91 99000-22222', project: 'SEO Audit' }
    ];

    const enrollments = enrollBatchInCadence(agencyCadence, leads);
    await StorageService.saveCadenceEnrollmentsBatch(enrollments);

    const stored = await StorageService.getCadenceEnrollments();
    assert.strictEqual(stored.length, 2);

    // Simulate Lead Alpha replying on WhatsApp Web
    const replyResult = await StorageService.recordCadenceContactReply('919900011111', 'Lead Alpha');
    assert.strictEqual(replyResult.modifiedCount, 1);
    assert.strictEqual(replyResult.haltedEnrollments[0].contactName, 'Lead Alpha');
    assert.strictEqual(replyResult.haltedEnrollments[0].status, CADENCE_STATUS.REPLIED);

    // Verify stored state in storage
    const storedAfter = await StorageService.getCadenceEnrollments();
    const leadAlpha = storedAfter.find((e) => e.cleanPhone === '919900011111');
    const leadBeta = storedAfter.find((e) => e.cleanPhone === '919900022222');

    assert.strictEqual(leadAlpha.status, CADENCE_STATUS.REPLIED);
    assert.strictEqual(leadAlpha.nextStepDueAt, null);
    // Lead Beta remains active/due
    assert.notStrictEqual(leadBeta.status, CADENCE_STATUS.REPLIED);
  });

  it('should refresh due cadence enrollments ready for side panel queue', async () => {
    const blueprints = await StorageService.getCadenceBlueprints();
    const agencyCadence = blueprints[0];

    const lead = { name: 'Urgent Lead', phone: '918888800000' };
    const enr = enrollContactInCadence(agencyCadence, lead);
    // Advance to Step 2 with due date set in the past
    const step2 = recordStepSent(enr, agencyCadence, { sentAt: '2026-11-01T10:00:00.000Z' });
    step2.nextStepDueAt = '2026-11-04T10:00:00.000Z'; // Was due 7 days ago

    await StorageService.saveCadenceEnrollment(step2);

    const { due } = await StorageService.refreshDueCadenceEnrollments(new Date('2026-11-11T12:00:00.000Z'));
    assert.strictEqual(due.length, 1);
    assert.strictEqual(due[0].contactName, 'Urgent Lead');
    assert.strictEqual(due[0].status, CADENCE_STATUS.DUE);
  });
});

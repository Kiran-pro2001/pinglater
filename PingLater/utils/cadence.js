/**
 * PingLater - Multi-Step Follow-Up Cadence Engine (Feature 5)
 * Pure JavaScript, zero-dependency state machine for drip follow-up sequences.
 * 
 * Features:
 * - Multi-step sequences (e.g. Day 1 -> Day 3 -> Day 7)
 * - Automatic stop-on-reply (halts sequence immediately if contact replies)
 * - Dynamic variable interpolation ({{name}}, {{company}}, etc.)
 * - Delay calculation in days or hours
 * - Ready-to-send queue generation for Side Panel
 * - Pure functions with full unit testability
 */

// Cadence Enrollment Status Constants
export const CADENCE_STATUS = {
  ACTIVE: 'active',             // Enrolled and in progress
  AWAITING_REPLY: 'awaiting',   // Step sent, waiting for reply or next delay
  DUE: 'due',                   // Delay elapsed, follow-up message ready to send
  REPLIED: 'replied',           // Contact replied! Sequence halted permanently
  COMPLETED: 'completed',       // All steps sent without reply, sequence finished
  PAUSED: 'paused',             // Temporarily paused by user
  CANCELLED: 'cancelled'        // Sequence cancelled by user
};

export const CADENCE_STORAGE_KEYS = {
  BLUEPRINTS: 'pinglater_cadence_blueprints',
  ENROLLMENTS: 'pinglater_cadence_enrollments'
};

// Preset Cadence Blueprints for high-converting sales & follow-up scenarios
export const PRESET_CADENCES = [
  {
    id: 'cadence_agency_outreach_3step',
    name: '3-Step Agency Outreach (Cold Lead)',
    description: 'High-converting sequence: Value Intro → Quick 3-Day Bump → Polite Break-Up.',
    isPreset: true,
    category: 'Sales Outreach',
    createdAt: '2026-11-11T00:00:00.000Z',
    updatedAt: '2026-11-11T00:00:00.000Z',
    steps: [
      {
        stepIndex: 0,
        stepNumber: 1,
        title: 'Initial Value Pitch',
        delayDays: 0,
        delayHours: 0,
        message: 'Hi {{name}}, noticed your work on {{project}}! We recently helped a brand in your niche boost conversions by 35% in 30 days. Would you be open to a quick 5-min chat this week?',
        condition: 'always'
      },
      {
        stepIndex: 1,
        stepNumber: 2,
        title: '3-Day Value Bump',
        delayDays: 3,
        delayHours: 72,
        message: 'Hey {{name}}, just bumping this in case it got buried under client messages! Here is a 1-page overview of what we built: https://pinglater.com/demo. Would love your thoughts!',
        condition: 'if_no_reply'
      },
      {
        stepIndex: 2,
        stepNumber: 3,
        title: '7-Day Polite Break-Up',
        delayDays: 4, // 4 days after Step 2 (Day 7 total)
        delayHours: 96,
        message: 'Hi {{name}}, assume priorities shifted right now — totally understand! I\'ll stop following up for now. Whenever you\'re looking to scale outreach, feel free to ping me. Wishing you all the best!',
        condition: 'if_no_reply'
      }
    ]
  },
  {
    id: 'cadence_proposal_closing',
    name: 'Proposal & Quote Closing Sequence',
    description: 'Close proposals faster: Review Check-In → Addressing Concerns → Final Offer.',
    isPreset: true,
    category: 'Client Closing',
    createdAt: '2026-11-11T00:00:00.000Z',
    updatedAt: '2026-11-11T00:00:00.000Z',
    steps: [
      {
        stepIndex: 0,
        stepNumber: 1,
        title: 'Proposal Sent & Walkthrough',
        delayDays: 0,
        delayHours: 0,
        message: 'Hi {{name}}, just sent over the proposal for {{project}}! Please have a look and let me know if everything aligns with your goals.',
        condition: 'always'
      },
      {
        stepIndex: 1,
        stepNumber: 2,
        title: '2-Day Feedback & Questions Check',
        delayDays: 2,
        delayHours: 48,
        message: 'Hi {{name}}, following up on the proposal sent two days ago. Did you get a chance to review? Happy to jump on a quick 5-min call to answer any questions on scope or timeline.',
        condition: 'if_no_reply'
      },
      {
        stepIndex: 2,
        stepNumber: 3,
        title: '5-Day Closing Decision Nudge',
        delayDays: 3, // 3 days after step 2 (Day 5 total)
        delayHours: 72,
        message: 'Hey {{name}}, checking in before we finalize our client roster for next month. Are you still looking to kick off {{project}} with us? Let me know so we can reserve your slot!',
        condition: 'if_no_reply'
      }
    ]
  },
  {
    id: 'cadence_event_noshow',
    name: 'Event / Webinar No-Show Re-engagement',
    description: 'Re-engage leads who missed an event: Recording Link → Key Slides → Next Workshop.',
    isPreset: true,
    category: 'Lead Nurture',
    createdAt: '2026-11-11T00:00:00.000Z',
    updatedAt: '2026-11-11T00:00:00.000Z',
    steps: [
      {
        stepIndex: 0,
        stepNumber: 1,
        title: 'Sorry We Missed You (Recording)',
        delayDays: 0,
        delayHours: 0,
        message: 'Hi {{name}}, sorry we missed you at the live session today! Here is the direct replay recording: https://pinglater.com/replay. Hope you find it useful!',
        condition: 'always'
      },
      {
        stepIndex: 1,
        stepNumber: 2,
        title: '2-Day Key Takeaways & PDF',
        delayDays: 2,
        delayHours: 48,
        message: 'Hey {{name}}, put together the top 3 action items and templates from the webinar into a quick 2-page PDF for you. Would you like me to send it over?',
        condition: 'if_no_reply'
      }
    ]
  }
];

/**
 * Normalizes a phone number to digits only
 */
export function normalizeCadencePhone(phone) {
  if (!phone) return '';
  return String(phone).replace(/\D/g, '');
}

/**
 * Interpolates variables ({{name}}, {{project}}, etc.) into a template string.
 * Supports case-insensitive matches and defaults {{name}} to "there".
 */
export function interpolateCadenceMessage(templateText, variables = {}) {
  if (!templateText) return '';
  let result = String(templateText);

  // Normalize variable keys to lower-case for lenient matching
  const varMap = {};
  for (const [k, v] of Object.entries(variables || {})) {
    varMap[k.toLowerCase()] = v;
  }

  // Handle common name aliases
  if (!varMap['name'] && varMap['firstname']) varMap['name'] = varMap['firstname'];
  if (!varMap['name'] && varMap['first_name']) varMap['name'] = varMap['first_name'];

  // Replace {{var}} patterns
  result = result.replace(/\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g, (match, key) => {
    const lowerKey = key.toLowerCase();
    if (varMap[lowerKey] !== undefined && varMap[lowerKey] !== null && String(varMap[lowerKey]).trim() !== '') {
      return String(varMap[lowerKey]).trim();
    }
    // Contextual intelligent fallbacks
    if (lowerKey === 'name' || lowerKey === 'firstname' || lowerKey === 'first_name') {
      return 'there';
    }
    return '';
  });

  return result.trim();
}

/**
 * Calculates due timestamp based on delay in days and/or hours from a reference date.
 */
export function calculateStepDueDate(delayDays = 0, delayHours = 0, fromDate = new Date()) {
  const ref = new Date(fromDate);
  if (isNaN(ref.getTime())) return new Date().toISOString();

  let totalHours = 0;
  if (delayHours > 0) {
    totalHours = delayHours;
  } else if (delayDays > 0) {
    totalHours = delayDays * 24;
  }

  const totalMs = totalHours * 3600 * 1000;
  return new Date(ref.getTime() + totalMs).toISOString();
}

/**
 * Creates and validates a new Cadence Blueprint object.
 */
export function createCadenceBlueprint({
  id,
  name,
  description = '',
  category = 'Custom',
  steps = []
}) {
  if (!name || !name.trim()) {
    throw new Error('Cadence Blueprint must have a valid name.');
  }

  if (!Array.isArray(steps) || steps.length === 0) {
    throw new Error('Cadence Blueprint must contain at least 1 step.');
  }

  const cleanSteps = steps.map((s, idx) => {
    const stepNumber = idx + 1;
    const delayDays = Math.max(0, parseInt(s.delayDays, 10) || 0);
    const delayHours = Math.max(0, parseInt(s.delayHours, 10) || (delayDays * 24));
    return {
      stepIndex: idx,
      stepNumber: stepNumber,
      title: s.title && s.title.trim() ? s.title.trim() : `Step ${stepNumber}`,
      delayDays: delayDays,
      delayHours: delayHours,
      message: (s.message || '').trim(),
      condition: idx === 0 ? 'always' : (s.condition || 'if_no_reply')
    };
  });

  const now = new Date().toISOString();
  return {
    id: id || `cadence_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    name: name.trim(),
    description: description.trim(),
    category: category.trim(),
    isPreset: false,
    createdAt: now,
    updatedAt: now,
    steps: cleanSteps
  };
}

/**
 * Enrolls a single contact into a Cadence Blueprint.
 */
export function enrollContactInCadence(cadence, contact, options = {}) {
  if (!cadence || !Array.isArray(cadence.steps) || cadence.steps.length === 0) {
    throw new Error('Cannot enroll contact: Invalid cadence blueprint.');
  }

  const phone = contact.phone || contact.phoneNumber || '';
  const cleanPhone = normalizeCadencePhone(phone);
  if (!cleanPhone && !contact.name) {
    throw new Error('Cannot enroll contact: Must have a phone number or contact name.');
  }

  const now = options.enrolledAt ? new Date(options.enrolledAt) : new Date();
  const step0 = cadence.steps[0];

  // Calculate when Step 1 is due (if delay is 0, due immediately)
  const nextDue = calculateStepDueDate(step0.delayDays, step0.delayHours, now);
  const isDueImmediately = new Date(nextDue).getTime() <= now.getTime();

  const variables = Object.assign({}, contact.variables || {}, {
    name: contact.name || '',
    phone: cleanPhone,
    company: contact.company || contact.organization || '',
    project: contact.project || contact.topic || ''
  });

  // Preserve any other flat properties on contact
  for (const [k, v] of Object.entries(contact)) {
    if (!['name', 'phone', 'phoneNumber', 'variables'].includes(k) && typeof v === 'string') {
      variables[k] = v;
    }
  }

  const enrollment = {
    id: `enr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    cadenceId: cadence.id,
    cadenceName: cadence.name,
    contactName: (contact.name || cleanPhone || 'Contact').trim(),
    phone: phone,
    cleanPhone: cleanPhone,
    variables: variables,
    currentStepIndex: 0,
    totalSteps: cadence.steps.length,
    status: isDueImmediately ? CADENCE_STATUS.DUE : CADENCE_STATUS.AWAITING_REPLY,
    enrolledAt: now.toISOString(),
    nextStepDueAt: nextDue,
    lastSentAt: null,
    repliedAt: null,
    history: []
  };

  return enrollment;
}

/**
 * Enrolls a batch of contacts into a Cadence Blueprint.
 * Skips duplicates if cleanPhone is already enrolled in the list.
 */
export function enrollBatchInCadence(cadence, contactsList = [], existingEnrollments = [], options = {}) {
  const newEnrollments = [];
  const existingPhoneSet = new Set(
    existingEnrollments
      .filter((e) => [CADENCE_STATUS.ACTIVE, CADENCE_STATUS.AWAITING_REPLY, CADENCE_STATUS.DUE].includes(e.status))
      .map((e) => e.cleanPhone)
      .filter(Boolean)
  );

  for (const c of contactsList) {
    const cleanPhone = normalizeCadencePhone(c.phone || c.phoneNumber);
    // Avoid double-enrolling the same active contact in the same cadence
    if (cleanPhone && existingPhoneSet.has(cleanPhone) && !options.allowDuplicates) {
      continue;
    }
    const enr = enrollContactInCadence(cadence, c, options);
    newEnrollments.push(enr);
    if (cleanPhone) existingPhoneSet.add(cleanPhone);
  }

  return newEnrollments;
}

/**
 * Advances an enrollment after the current step has been sent.
 * - Records step in history
 * - Schedules next step OR completes the cadence
 * - Respects stop-on-reply: cannot advance if already replied
 */
export function recordStepSent(enrollment, cadence, options = {}) {
  if (!enrollment) throw new Error('Enrollment object is required');
  if (enrollment.status === CADENCE_STATUS.REPLIED) {
    throw new Error('Cannot advance cadence: Contact has already replied! Cadence is permanently halted.');
  }

  const now = options.sentAt ? new Date(options.sentAt) : new Date();
  const currentStep = cadence?.steps ? cadence.steps[enrollment.currentStepIndex] : null;
  const messageBody = options.message || (currentStep ? interpolateCadenceMessage(currentStep.message, enrollment.variables) : '');

  // 1. Record completed step in history
  const historyItem = {
    stepIndex: enrollment.currentStepIndex,
    stepNumber: enrollment.currentStepIndex + 1,
    stepTitle: currentStep?.title || `Step ${enrollment.currentStepIndex + 1}`,
    sentAt: now.toISOString(),
    message: messageBody,
    status: 'sent'
  };

  const updatedHistory = Array.isArray(enrollment.history) ? [...enrollment.history, historyItem] : [historyItem];
  const nextStepIndex = enrollment.currentStepIndex + 1;

  // 2. Check if more steps exist
  if (cadence && nextStepIndex < cadence.steps.length) {
    const nextStep = cadence.steps[nextStepIndex];
    const nextDue = calculateStepDueDate(nextStep.delayDays, nextStep.delayHours, now);

    return {
      ...enrollment,
      currentStepIndex: nextStepIndex,
      lastSentAt: now.toISOString(),
      nextStepDueAt: nextDue,
      status: CADENCE_STATUS.AWAITING_REPLY,
      history: updatedHistory,
      updatedAt: now.toISOString()
    };
  } else {
    // Sequence completed!
    return {
      ...enrollment,
      lastSentAt: now.toISOString(),
      nextStepDueAt: null,
      status: CADENCE_STATUS.COMPLETED,
      history: updatedHistory,
      completedAt: now.toISOString(),
      updatedAt: now.toISOString()
    };
  }
}

/**
 * Handles incoming reply event for an enrollment.
 * Immediately halts the cadence permanently.
 */
export function recordContactReplied(enrollment, replyTimestamp = new Date()) {
  if (!enrollment) return null;
  if (enrollment.status === CADENCE_STATUS.COMPLETED || enrollment.status === CADENCE_STATUS.CANCELLED) {
    return enrollment; // already terminal
  }

  const repliedTime = new Date(replyTimestamp).toISOString();
  return {
    ...enrollment,
    status: CADENCE_STATUS.REPLIED,
    repliedAt: repliedTime,
    nextStepDueAt: null, // clear future alarms
    updatedAt: repliedTime
  };
}

/**
 * Evaluates all enrollments against a reference timestamp and marks due steps.
 */
export function checkDueEnrollments(enrollments = [], referenceTime = new Date()) {
  const refTime = new Date(referenceTime).getTime();
  const updatedList = [];
  const dueItems = [];

  for (const enr of enrollments) {
    if (enr.status === CADENCE_STATUS.AWAITING_REPLY && enr.nextStepDueAt) {
      const dueTime = new Date(enr.nextStepDueAt).getTime();
      if (!isNaN(dueTime) && refTime >= dueTime) {
        const dueEnr = {
          ...enr,
          status: CADENCE_STATUS.DUE,
          updatedAt: new Date(referenceTime).toISOString()
        };
        updatedList.push(dueEnr);
        dueItems.push(dueEnr);
        continue;
      }
    }
    updatedList.push(enr);
  }

  return { updatedList, dueItems };
}

/**
 * Pauses an active enrollment.
 */
export function pauseEnrollment(enrollment) {
  if (!enrollment || [CADENCE_STATUS.REPLIED, CADENCE_STATUS.COMPLETED, CADENCE_STATUS.CANCELLED].includes(enrollment.status)) {
    return enrollment;
  }
  return {
    ...enrollment,
    status: CADENCE_STATUS.PAUSED,
    pausedAt: new Date().toISOString()
  };
}

/**
 * Resumes a paused enrollment.
 */
export function resumeEnrollment(enrollment, referenceTime = new Date()) {
  if (!enrollment || enrollment.status !== CADENCE_STATUS.PAUSED) {
    return enrollment;
  }
  const ref = new Date(referenceTime);
  const nextDue = enrollment.nextStepDueAt ? new Date(enrollment.nextStepDueAt) : ref;
  const isDue = nextDue.getTime() <= ref.getTime();

  return {
    ...enrollment,
    status: isDue ? CADENCE_STATUS.DUE : CADENCE_STATUS.AWAITING_REPLY,
    resumedAt: ref.toISOString()
  };
}

/**
 * Cancels an enrollment.
 */
export function cancelEnrollment(enrollment) {
  if (!enrollment) return null;
  return {
    ...enrollment,
    status: CADENCE_STATUS.CANCELLED,
    cancelledAt: new Date().toISOString(),
    nextStepDueAt: null
  };
}

/**
 * Formats a delay into a human-friendly string (e.g. "3 days", "48 hours", "Immediately").
 */
export function formatDelayText(delayDays = 0, delayHours = 0) {
  if (delayDays === 0 && delayHours === 0) return 'Immediately (Day 1)';
  if (delayDays > 0) {
    return `${delayDays} day${delayDays > 1 ? 's' : ''}${delayHours % 24 > 0 ? ` ${delayHours % 24}h` : ''}`;
  }
  return `${delayHours} hour${delayHours > 1 ? 's' : ''}`;
}

/**
 * Calculates aggregate performance analytics for a list of enrollments.
 */
export function calculateCadenceMetrics(enrollments = []) {
  const total = enrollments.length;
  if (total === 0) {
    return {
      total: 0,
      active: 0,
      due: 0,
      replied: 0,
      completed: 0,
      paused: 0,
      replyRatePct: 0
    };
  }

  let active = 0;
  let due = 0;
  let replied = 0;
  let completed = 0;
  let paused = 0;

  for (const e of enrollments) {
    if (e.status === CADENCE_STATUS.ACTIVE || e.status === CADENCE_STATUS.AWAITING_REPLY) active++;
    else if (e.status === CADENCE_STATUS.DUE) due++;
    else if (e.status === CADENCE_STATUS.REPLIED) replied++;
    else if (e.status === CADENCE_STATUS.COMPLETED) completed++;
    else if (e.status === CADENCE_STATUS.PAUSED) paused++;
  }

  const reachedReplyStage = replied + completed + active + due;
  const replyRatePct = reachedReplyStage > 0 ? Math.round((replied / reachedReplyStage) * 100) : 0;

  return {
    total,
    active,
    due,
    replied,
    completed,
    paused,
    replyRatePct
  };
}

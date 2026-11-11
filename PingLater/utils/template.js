/**
 * PingLater - Message Template & Dynamic Variable Engine (Module 3)
 * Handles variable extraction, interpolation, fallback rules,
 * pre-flight batch validation, and WhatsApp Web URL generation.
 */

// Matches {{variable}} or {{variable|fallback}}
const VARIABLE_REGEX = /\{\{\s*([a-zA-Z0-9_\-\s]+?)(?:\|([^}]+?))?\s*\}\}/g;

/**
 * Extracts all unique dynamic variables from a template body.
 * @param {string} templateBody
 * @returns {string[]} List of variable keys in lowercase/normalized form
 */
export function extractVariables(templateBody) {
  if (!templateBody || typeof templateBody !== 'string') return [];

  const variables = new Set();
  let match;
  const regex = new RegExp(VARIABLE_REGEX);

  while ((match = regex.exec(templateBody)) !== null) {
    const varName = match[1].trim();
    if (varName) {
      variables.add(varName);
    }
  }

  return Array.from(variables);
}

/**
 * Renders a template by interpolating data from a recipient's fields.
 * Supports case-insensitive matching and {{var|fallback}} defaults.
 *
 * @param {string} templateBody
 * @param {Record<string, any>} dataObject - e.g. { name: 'Kiran', event: 'Web3 BLR' }
 * @param {object} [options]
 * @param {boolean} [options.highlightMissing=false] - For previewing missing vars with [MISSING: var]
 * @returns {string} The personalized rendered text
 */
export function renderTemplate(templateBody, dataObject = {}, options = {}) {
  if (!templateBody || typeof templateBody !== 'string') return '';
  const { highlightMissing = false } = options;

  // Build a normalized lookup map (lowercase alphanumeric keys for fuzzy matching)
  const lookup = new Map();
  for (const [k, v] of Object.entries(dataObject)) {
    const valStr = v !== undefined && v !== null ? String(v).trim() : '';
    lookup.set(k.toLowerCase().trim(), valStr);
    lookup.set(k.toLowerCase().replace(/[^a-z0-9]/g, ''), valStr);
  }

  return templateBody.replace(VARIABLE_REGEX, (fullMatch, rawVarName, fallback) => {
    const varName = rawVarName.trim();
    const cleanKey = varName.toLowerCase();
    const strippedKey = cleanKey.replace(/[^a-z0-9]/g, '');

    let value = '';
    if (lookup.has(cleanKey) && lookup.get(cleanKey) !== '') {
      value = lookup.get(cleanKey);
    } else if (lookup.has(strippedKey) && lookup.get(strippedKey) !== '') {
      value = lookup.get(strippedKey);
    } else if (fallback !== undefined) {
      value = fallback.trim();
    } else if (cleanKey.includes('name') && lookup.has('name') && lookup.get('name')) {
      value = lookup.get('name');
    } else if (cleanKey.includes('first') || cleanKey === 'name') {
      value = 'there';
    } else if (highlightMissing) {
      value = `[MISSING: ${varName}]`;
    }

    return value;
  });
}

/**
 * Pre-flight health check: Scans an entire list of recipients against a template body
 * to find if any recipient has empty or missing variables.
 *
 * @param {string} templateBody
 * @param {Array<object>} recipients - Array of processed recipients with customFields
 * @returns {{
 *   isValid: boolean,
 *   usedVariables: string[],
 *   missingCount: number,
 *   warnings: Array<{ recipientName: string, rowIndex: number, missingVariable: string }>,
 *   summaryMessage: string|null
 * }}
 */
export function validateBatchVariables(templateBody, recipients = []) {
  const usedVariables = extractVariables(templateBody);
  const warnings = [];

  if (usedVariables.length === 0 || recipients.length === 0) {
    return {
      isValid: true,
      usedVariables,
      missingCount: 0,
      warnings: [],
      summaryMessage: null,
      primaryMissingVar: null
    };
  }

  // Check which variables have a fallback specified in the template (e.g. {{first_name|there}})
  const fallbackMap = new Map();
  const regex = new RegExp(VARIABLE_REGEX);
  let m;
  while ((m = regex.exec(templateBody)) !== null) {
    const vName = m[1].trim().toLowerCase();
    const fallback = m[2] !== undefined ? m[2].trim() : null;
    if (fallback) {
      fallbackMap.set(vName, fallback);
    }
  }

  for (let i = 0; i < recipients.length; i++) {
    const r = recipients[i];
    const fields = r.customFields || {};

    // Build lookup keys
    const lookup = new Map();
    for (const [k, v] of Object.entries(fields)) {
      lookup.set(k.toLowerCase().trim(), String(v || '').trim());
      lookup.set(k.toLowerCase().replace(/[^a-z0-9]/g, ''), String(v || '').trim());
    }

    for (const vName of usedVariables) {
      const cleanKey = vName.toLowerCase();
      const strippedKey = cleanKey.replace(/[^a-z0-9]/g, '');

      const hasVal =
        (lookup.has(cleanKey) && lookup.get(cleanKey) !== '') ||
        (lookup.has(strippedKey) && lookup.get(strippedKey) !== '');

      // If value is missing BUT template provides a fallback (e.g. {{first_name|there}}), it's safe!
      const hasFallback = fallbackMap.has(cleanKey) || fallbackMap.has(strippedKey);

      if (!hasVal && !hasFallback) {
        warnings.push({
          recipientName: r.name || `Row ${r.rowIndex || i + 1}`,
          rowIndex: r.rowIndex || i + 1,
          missingVariable: vName
        });
      }
    }
  }

  const isValid = warnings.length === 0;
  let summaryMessage = null;
  let primaryMissingVar = null;

  if (!isValid) {
    const uniqueMissing = Array.from(new Set(warnings.map((w) => w.missingVariable)));
    primaryMissingVar = uniqueMissing[0];
    const missingVarNames = uniqueMissing.map((v) => `{{${v}}}`);
    summaryMessage = `${warnings.length} missing field value(s) detected across recipients for: ${missingVarNames.join(', ')}.`;
  }

  return {
    isValid,
    usedVariables,
    missingCount: warnings.length,
    warnings,
    summaryMessage,
    primaryMissingVar
  };
}

/**
 * Generates the direct WhatsApp Web click-to-chat URL with prefilled text.
 * Skips intermediate landing pages and directly focuses the chat input box.
 *
 * @param {string} phone - Sanitized E.164 phone number (e.g. "919876543210")
 * @param {string} renderedMessage - Final text message to prefill
 * @returns {string} Fully encoded WhatsApp Web URL
 */
export function generateWhatsAppUrl(phone, renderedMessage) {
  const cleanPhone = String(phone || '').replace(/\D/g, '');
  const encodedText = encodeURIComponent(renderedMessage || '');
  return `https://web.whatsapp.com/send/?phone=${cleanPhone}&text=${encodedText}&type=phone_number&app_absent=0`;
}

/**
 * Renders all recipients in a batch with the selected template body,
 * populating recipient.renderedMessage.
 *
 * @param {string} templateBody
 * @param {Array<object>} recipients
 * @returns {Array<object>} Updated recipients with renderedMessage
 */
export function renderBatchRecipients(templateBody, recipients = []) {
  return recipients.map((r) => {
    const rendered = renderTemplate(templateBody, r.customFields || { name: r.name, phone: r.phone });
    return {
      ...r,
      renderedMessage: rendered
    };
  });
}

// Attach to globalThis for non-module script access if needed
if (typeof globalThis !== 'undefined') {
  globalThis.PingLaterTemplate = {
    extractVariables,
    renderTemplate,
    validateBatchVariables,
    generateWhatsAppUrl,
    renderBatchRecipients
  };
}

/**
 * PingLater - Normalizer & CSV Ingestion Engine (Module 2)
 * Handles CSV parsing, dynamic column mapping, phone sanitization,
 * E.164 normalization, and duplicate detection.
 */

// Common country code reference for default selections & lookups
export const COMMON_COUNTRY_CODES = [
  { name: 'India', code: '91', flag: '🇮🇳' },
  { name: 'United States / Canada', code: '1', flag: '🇺🇸' },
  { name: 'United Kingdom', code: '44', flag: '🇬🇧' },
  { name: 'United Arab Emirates', code: '971', flag: '🇦🇪' },
  { name: 'Singapore', code: '65', flag: '🇸🇬' },
  { name: 'Australia', code: '61', flag: '🇦🇺' },
  { name: 'Germany', code: '49', flag: '🇩🇪' },
  { name: 'Saudi Arabia', code: '966', flag: '🇸🇦' },
  { name: 'Indonesia', code: '62', flag: '🇮🇩' },
  { name: 'Brazil', code: '55', flag: '🇧🇷' }
];

/**
 * Robust CSV string parser handling quotes, commas, semicolons, tabs, and multiline values.
 * @param {string} csvText
 * @returns {{ headers: string[], rows: Record<string, string>[] }}
 */
export function parseCSV(csvText) {
  if (!csvText || typeof csvText !== 'string') {
    return { headers: [], rows: [] };
  }

  // Detect delimiter: comma, semicolon, or tab
  const firstLine = csvText.split(/\r\n|\n|\r/)[0] || '';
  let delimiter = ',';
  if (firstLine.includes('\t')) {
    delimiter = '\t';
  } else if (firstLine.split(';').length > firstLine.split(',').length) {
    delimiter = ';';
  }

  const lines = tokenizeCSV(csvText, delimiter);
  if (!lines || lines.length === 0) {
    return { headers: [], rows: [] };
  }

  // Extract and clean headers
  const rawHeaders = lines[0].map((h) => h.trim());
  const headers = [];
  const headerCountMap = new Map();

  for (let i = 0; i < rawHeaders.length; i++) {
    let name = rawHeaders[i] || `Column_${i + 1}`;
    // Deduplicate headers if needed
    if (headerCountMap.has(name)) {
      const count = headerCountMap.get(name) + 1;
      headerCountMap.set(name, count);
      name = `${name}_${count}`;
    } else {
      headerCountMap.set(name, 1);
    }
    headers.push(name);
  }

  // Build row objects
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.length === 0 || (line.length === 1 && line[0].trim() === '')) {
      continue; // Skip blank lines
    }

    const rowObj = {};
    for (let j = 0; j < headers.length; j++) {
      rowObj[headers[j]] = (line[j] !== undefined ? line[j] : '').trim();
    }
    rows.push(rowObj);
  }

  return { headers, rows };
}

/**
 * Tokenizes raw CSV characters respecting quoted sections and escaped quotes ("").
 */
function tokenizeCSV(text, delimiter) {
  const result = [];
  let row = [];
  let currentToken = '';
  let insideQuotes = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (insideQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote: "" -> "
          currentToken += '"';
          i++;
        } else {
          insideQuotes = false;
        }
      } else {
        currentToken += char;
      }
    } else {
      if (char === '"') {
        insideQuotes = true;
      } else if (char === delimiter) {
        row.push(currentToken);
        currentToken = '';
      } else if (char === '\r') {
        if (nextChar === '\n') {
          i++;
        }
        row.push(currentToken);
        result.push(row);
        row = [];
        currentToken = '';
      } else if (char === '\n') {
        row.push(currentToken);
        result.push(row);
        row = [];
        currentToken = '';
      } else {
        currentToken += char;
      }
    }
    i++;
  }

  if (currentToken !== '' || row.length > 0) {
    row.push(currentToken);
    result.push(row);
  }

  return result;
}

/**
 * Detects the most likely "Name" and "Phone" columns from header names.
 * @param {string[]} headers
 * @returns {{ phoneColumn: string|null, nameColumn: string|null }}
 */
export function autoDetectColumns(headers) {
  let phoneColumn = null;
  let nameColumn = null;

  const phoneKeywords = ['phone', 'mobile', 'whatsapp', 'contact', 'cell', 'tel', 'ph', 'number'];
  const nameKeywords = ['name', 'full name', 'fullname', 'first name', 'attendee', 'recipient', 'lead', 'client'];

  for (const h of headers) {
    const clean = h.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!phoneColumn) {
      if (phoneKeywords.some((k) => clean.includes(k.replace(/[^a-z0-9]/g, '')))) {
        phoneColumn = h;
      }
    }
    if (!nameColumn) {
      if (nameKeywords.some((k) => clean.includes(k.replace(/[^a-z0-9]/g, '')))) {
        nameColumn = h;
      }
    }
  }

  return { phoneColumn, nameColumn };
}

/**
 * Cleans, sanitizes and normalizes phone numbers for WhatsApp Web compatibility.
 * Removes all non-digit characters, adds default country code when missing,
 * and validates length.
 *
 * @param {string|number} rawNumber
 * @param {string} defaultCountryCode - e.g. "91"
 * @returns {{ isValid: boolean, normalized: string, original: string, error?: string }}
 */
export function normalizePhoneNumber(rawNumber, defaultCountryCode = '91') {
  const original = String(rawNumber || '').trim();
  if (!original) {
    return { isValid: false, normalized: '', original, error: 'Empty phone number' };
  }

  // Strip country code plus sign if provided in default (e.g. "+91" -> "91")
  const cleanDefaultCC = String(defaultCountryCode).replace(/\D/g, '') || '91';

  // Remove whitespace, dashes, parentheses, dots
  let digits = original.replace(/\D/g, '');

  // Handle leading 00 (international call prefix, e.g. 0091 -> 91)
  if (digits.startsWith('00')) {
    digits = digits.substring(2);
  }

  // Handle single leading 0 (domestic trunk prefix, e.g. 09876543210 -> 9876543210)
  if (digits.startsWith('0') && digits.length === 11) {
    digits = digits.substring(1);
  }

  // If number does not have country code (e.g., 10 digits for India/US)
  // Standard local mobile numbers are typically 10 digits
  if (digits.length === 10) {
    digits = `${cleanDefaultCC}${digits}`;
  } else if (digits.length === 8 && cleanDefaultCC === '65') {
    // Singapore 8-digit mobile
    digits = `${cleanDefaultCC}${digits}`;
  }

  // Validation: WhatsApp E.164 numbers are between 10 and 15 digits
  if (digits.length < 10) {
    return {
      isValid: false,
      normalized: digits,
      original,
      error: 'Number too short (< 10 digits)'
    };
  }

  if (digits.length > 15) {
    return {
      isValid: false,
      normalized: digits,
      original,
      error: 'Number too long (> 15 digits)'
    };
  }

  return {
    isValid: true,
    normalized: digits,
    original
  };
}

/**
 * Parses free-form text input (e.g. pasted list of numbers or name, phone lines)
 * @param {string} text
 * @param {string} defaultCountryCode
 * @returns {{ name: string, phone: string }[]}
 */
export function parsePastedText(text, defaultCountryCode = '91') {
  if (!text || typeof text !== 'string') return [];

  const lines = text.split(/\r\n|\n|\r/);
  const results = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check if line contains a comma or tab separating name and phone
    if (trimmed.includes(',') || trimmed.includes('\t')) {
      const parts = trimmed.split(/[\t,]/).map((p) => p.trim());
      const name = parts[0];
      const phoneRaw = parts[1];
      const norm = normalizePhoneNumber(phoneRaw, defaultCountryCode);
      if (norm.isValid) {
        results.push({ name, phone: norm.normalized, originalPhone: phoneRaw });
      }
    } else {
      // Just a phone number or single string
      const norm = normalizePhoneNumber(trimmed, defaultCountryCode);
      if (norm.isValid) {
        results.push({ name: '', phone: norm.normalized, originalPhone: trimmed });
      }
    }
  }

  return results;
}

/**
 * Ingests rows from CSV and generates a validated list of recipients with duplicate checks.
 *
 * @param {Record<string, string>[]} rows
 * @param {{ nameColumn: string, phoneColumn: string }} columnMapping
 * @param {string} defaultCountryCode
 * @returns {{
 *   total: number,
 *   validCount: number,
 *   invalidCount: number,
 *   duplicateCount: number,
 *   recipients: Array<object>,
 *   duplicates: Array<object>
 * }}
 */
export function processRecipientsList(rows, columnMapping, defaultCountryCode = '91') {
  const { nameColumn, phoneColumn } = columnMapping;
  const recipients = [];
  const duplicates = [];
  const seenPhoneMap = new Map();

  let validCount = 0;
  let invalidCount = 0;
  let duplicateCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rawName = nameColumn && row[nameColumn] ? row[nameColumn] : `Recipient ${i + 1}`;
    const rawPhone = phoneColumn && row[phoneColumn] ? row[phoneColumn] : '';

    const norm = normalizePhoneNumber(rawPhone, defaultCountryCode);

    // Build customFields (all columns in the CSV row for {{variable}} replacement)
    const customFields = {};
    for (const [key, val] of Object.entries(row)) {
      customFields[key.trim()] = String(val !== undefined ? val : '').trim();
    }
    // Ensure standard 'name' and 'phone' are accessible regardless of CSV header casing
    if (!customFields.name) customFields.name = rawName;
    if (!customFields.phone) customFields.phone = norm.normalized || rawPhone;

    const recipientObj = {
      id: `rec_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 6)}`,
      name: rawName,
      phone: norm.normalized || rawPhone,
      rawPhone,
      isValid: norm.isValid,
      validationError: norm.error || null,
      isDuplicate: false,
      status: 'pending',
      customFields,
      rowIndex: i + 1
    };

    if (norm.isValid) {
      if (seenPhoneMap.has(norm.normalized)) {
        recipientObj.isDuplicate = true;
        recipientObj.duplicateOfRow = seenPhoneMap.get(norm.normalized);
        duplicateCount++;
        duplicates.push(recipientObj);
      } else {
        seenPhoneMap.set(norm.normalized, i + 1);
        validCount++;
      }
    } else {
      invalidCount++;
    }

    recipients.push(recipientObj);
  }

  return {
    total: rows.length,
    validCount,
    invalidCount,
    duplicateCount,
    recipients,
    duplicates
  };
}

// Attach to globalThis for non-module script access if needed
if (typeof globalThis !== 'undefined') {
  globalThis.PingLaterNormalizer = {
    parseCSV,
    autoDetectColumns,
    normalizePhoneNumber,
    parsePastedText,
    processRecipientsList,
    COMMON_COUNTRY_CODES
  };
}

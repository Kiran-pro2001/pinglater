/**
 * PingLater - Google Sheets 2-Way Sync Engine (Module 8 / Feature 4)
 * Enables live import of leads/contacts from Google Sheets without manual CSV downloads,
 * plus automatic 2-way writeback of "Sent" and "Sent At" status via Google Apps Script Webhooks.
 */

export const GOOGLE_APPS_SCRIPT_TEMPLATE = `function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var values = sheet.getDataRange().getValues();
    if (values.length === 0) {
      return ContentService.createTextOutput(JSON.stringify({ success: false, error: "Empty sheet" }))
        .setMimeType(ContentService.MimeType.JSON);
    }
    
    var headers = values[0];
    var statusCol = -1;
    var sentAtCol = -1;
    var phoneCol = -1;
    
    // Find or create "Status" and "Sent At" columns
    for (var j = 0; j < headers.length; j++) {
      var h = String(headers[j]).trim().toLowerCase();
      if (h === 'status') statusCol = j + 1;
      if (h === 'sent at' || h === 'sent_at' || h === 'timestamp' || h === 'time sent') sentAtCol = j + 1;
      if (h.indexOf('phone') >= 0 || h.indexOf('mobile') >= 0 || h.indexOf('contact') >= 0 || h.indexOf('whatsapp') >= 0) {
        if (phoneCol === -1) phoneCol = j + 1;
      }
    }
    
    if (statusCol === -1) {
      statusCol = headers.length + 1;
      sheet.getRange(1, statusCol).setValue('Status');
    }
    if (sentAtCol === -1) {
      sentAtCol = (statusCol === headers.length + 1) ? headers.length + 2 : headers.length + 1;
      sheet.getRange(1, sentAtCol).setValue('Sent At');
    }
    
    var targetPhone = String(data.phone || '').replace(/\\D/g, '');
    var targetName = String(data.name || '').trim().toLowerCase();
    var updated = false;
    
    // Search rows for matching phone or name
    for (var i = 1; i < values.length; i++) {
      var rowPhone = phoneCol > 0 ? String(values[i][phoneCol - 1]).replace(/\\D/g, '') : '';
      var rowName = String(values[i][0] || '').trim().toLowerCase();
      
      var match = false;
      if (targetPhone && rowPhone && (rowPhone.indexOf(targetPhone) >= 0 || targetPhone.indexOf(rowPhone) >= 0)) {
        match = true;
      } else if (!targetPhone && targetName && rowName === targetName) {
        match = true;
      }
      
      if (match) {
        sheet.getRange(i + 1, statusCol).setValue(data.status || 'Sent');
        sheet.getRange(i + 1, sentAtCol).setValue(data.sentAt || new Date().toLocaleString());
        updated = true;
        break;
      }
    }
    
    return ContentService.createTextOutput(JSON.stringify({ success: true, updated: updated }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({ status: "PingLater Google Sheets Webhook Active" }))
    .setMimeType(ContentService.MimeType.JSON);
}`;

/**
 * Extracts Google Sheet ID and sheet GID from any Google Sheets share URL
 */
export function extractGoogleSheetDetails(url) {
  if (!url || typeof url !== 'string') return null;

  // Match spreadsheet ID: /spreadsheets/d/([a-zA-Z0-9-_]+)
  const idMatch = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (!idMatch) return null;

  const sheetId = idMatch[1];

  // Match optional gid: #gid=12345 or ?gid=12345
  const gidMatch = url.match(/[?#&]gid=([0-9]+)/);
  const gid = gidMatch ? gidMatch[1] : '0';

  const exportCsvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`;

  return {
    sheetId,
    gid,
    exportCsvUrl
  };
}

/**
 * Fetches live CSV data from a link-shared Google Sheet
 */
export async function fetchGoogleSheetCsv(url) {
  const details = extractGoogleSheetDetails(url);
  if (!details) {
    throw new Error('Invalid Google Sheets URL. Please copy and paste the full share link from your browser address bar.');
  }

  try {
    const response = await fetch(details.exportCsvUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/csv,text/plain,*/*'
      }
    });

    if (!response.ok) {
      if (response.status === 401 || response.status === 403 || response.redirected) {
        throw new Error('This Google Sheet is private. Please open the sheet, click "Share" in the top-right, and set General access to "Anyone with the link can view".');
      }
      throw new Error(`Google Sheets responded with HTTP error ${response.status}.`);
    }

    const csvText = await response.text();

    // If Google returned HTML instead of CSV (e.g. login redirect page)
    if (csvText.trim().startsWith('<!DOCTYPE html') || csvText.trim().startsWith('<html')) {
      throw new Error('Could not access sheet contents. Please verify the sheet permissions are set to "Anyone with the link can view".');
    }

    if (!csvText || csvText.trim().length === 0) {
      throw new Error('The Google Sheet appears to be empty.');
    }

    return {
      csvText,
      sheetId: details.sheetId,
      gid: details.gid,
      exportUrl: details.exportCsvUrl
    };
  } catch (err) {
    console.error('[PingLater] Error fetching Google Sheet:', err);
    throw err;
  }
}

/**
 * Sends a row update to the user's deployed Google Apps Script Webhook
 * Bypasses CORS preflight using text/plain payload
 */
export async function writeBackToGoogleSheet(webhookUrl, data) {
  if (!webhookUrl || typeof webhookUrl !== 'string') return { success: false, error: 'No webhook URL provided' };

  try {
    const payload = {
      action: 'updateRow',
      phone: data.phone || '',
      name: data.name || '',
      status: data.status || 'Sent',
      sentAt: data.sentAt || new Date().toLocaleString(),
      note: data.note || ''
    };

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8' // Bypasses CORS OPTIONS preflight in Google Apps Script
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      return { success: false, status: res.status };
    }

    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (e) {
      json = { raw: text };
    }

    return { success: true, result: json };
  } catch (err) {
    console.warn('[PingLater] Google Sheet writeback request error:', err);
    return { success: false, error: err.toString() };
  }
}

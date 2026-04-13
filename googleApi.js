class GoogleApiManager {
  constructor(authManager) {
    this.auth = authManager;
    this.DRIVE_FOLDER_ID = null;
    this.SHEET_ID = null;
  }

  getHeaders() {
    return {
      'Authorization': `Bearer ${this.auth.accessToken}`
    };
  }

  // Upload to Drive
  async uploadVideo(file, filename) {
    const metadata = {
      name: filename,
      parents: [this.DRIVE_FOLDER_ID],
      mimeType: file.type
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', file);

    const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink', {
      method: 'POST',
      headers: this.getHeaders(),
      body: form
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || 'Upload failed');
    }

    const fileData = await response.json();
    await this._setPermissions(fileData.id);
    return fileData;
  }

  async _setPermissions(fileId) {
    await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ role: 'reader', type: 'anyone' })
    });
  }

  // Get active Drive file IDs (for syncing library count)
  async getDriveFileIds() {
    if (!this.DRIVE_FOLDER_ID) return new Set();
    const q = encodeURIComponent(`'${this.DRIVE_FOLDER_ID}' in parents and trashed=false`);
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`, {
      headers: this.getHeaders()
    });
    if (!response.ok) return new Set();
    const data = await response.json();
    return new Set((data.files || []).map(f => f.id));
  }

  // Sheets API
  async getSheetData() {
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${this.SHEET_ID}/values/Sheet1!A:G`, {
      headers: this.getHeaders()
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Failed to fetch sheet data.');
    }

    return await response.json();
  }

  async appendSheetRow(rowData) {
    const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${this.SHEET_ID}/values/Sheet1!A:G:append?valueInputOption=USER_ENTERED`, {
      method: 'POST',
      headers: {
        ...this.getHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        values: [rowData]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Failed to append row');
    }

    return await response.json();
  }

  // --- Auto-Discovery Helpers ---

  async _findFile(name, mimeType = null, parentId = null) {
    let q = `name = '${name}' and trashed = false`;
    if (mimeType) q += ` and mimeType = '${mimeType}'`;
    if (parentId) q += ` and '${parentId}' in parents`;
    const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id)`, {
      headers: this.getHeaders()
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.files && data.files.length > 0 ? data.files[0].id : null;
  }

  async findOrCreateFolder(name) {
    let id = await this._findFile(name, 'application/vnd.google-apps.folder');
    if (id) return id;

    const response = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name, mimeType: 'application/vnd.google-apps.folder' })
    });
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Failed to create Drive folder');
    }
    const data = await response.json();
    return data.id;
  }

  async findOrCreateSheet(name, folderId) {
    // Search for existing sheet inside the folder
    let id = await this._findFile(name, 'application/vnd.google-apps.spreadsheet', folderId);
    if (id) return id;

    // Create new Spreadsheet with formatted header
    const response = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
      method: 'POST',
      headers: { ...this.getHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        properties: { title: name },
        sheets: [{
          properties: { title: 'Sheet1' },
          data: [{
            startRow: 0,
            startColumn: 0,
            rowData: [{
              values: [
                { userEnteredValue: { stringValue: 'Filename' }, userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.18, green: 0.20, blue: 0.25 }, horizontalAlignment: 'CENTER' } },
                { userEnteredValue: { stringValue: 'Mood' }, userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.18, green: 0.20, blue: 0.25 }, horizontalAlignment: 'CENTER' } },
                { userEnteredValue: { stringValue: 'Action' }, userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.18, green: 0.20, blue: 0.25 }, horizontalAlignment: 'CENTER' } },
                { userEnteredValue: { stringValue: 'Subject' }, userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.18, green: 0.20, blue: 0.25 }, horizontalAlignment: 'CENTER' } },
                { userEnteredValue: { stringValue: 'Setting' }, userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.18, green: 0.20, blue: 0.25 }, horizontalAlignment: 'CENTER' } },
                { userEnteredValue: { stringValue: 'Style' }, userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.18, green: 0.20, blue: 0.25 }, horizontalAlignment: 'CENTER' } },
                { userEnteredValue: { stringValue: 'Drive Link' }, userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.18, green: 0.20, blue: 0.25 }, horizontalAlignment: 'CENTER' } }
              ]
            }]
          }]
        }]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error?.message || 'Failed to create spreadsheet');
    }

    const data = await response.json();
    const sheetId = data.spreadsheetId;

    // Move spreadsheet into the ClipSorter folder
    try {
      await fetch(`https://www.googleapis.com/drive/v3/files/${sheetId}?addParents=${folderId}`, {
        method: 'PATCH',
        headers: this.getHeaders()
      });
    } catch(e) { /* non-critical */ }

    return sheetId;
  }
}

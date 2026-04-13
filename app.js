class App {
  constructor() {
    this.auth = new AuthManager();
    this.googleApi = new GoogleApiManager(this.auth);
    this.geminiApi = new GeminiApiManager();
    this.sheetRows = [];
    this.uploadedFile = null;

    // Wait for DOM, then init auth
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this._boot());
    } else {
      this._boot();
    }
  }

  _boot() {
    this.setupEventListeners();
    this.setupSettings();
    this.auth.init();
  }

  setupSettings() {
    const keyInput = document.getElementById('gemini-key-input');
    if (keyInput) {
      keyInput.value = localStorage.getItem('gemini_api_key') || '';
      keyInput.addEventListener('change', (e) => {
        localStorage.setItem('gemini_api_key', e.target.value.trim());
        this.showToast('API Key saved!', 'success');
      });
    }
  }

  // Called by auth.js after successful login
  async initAfterAuth() {
    document.getElementById('settings-area')?.classList.remove('hidden');

    try {
      this.showToast('Connecting to your library...', 'info');
      
      // Step 1: Find or Create the "ClipSorter Library" Folder
      const folderId = await this.googleApi.findOrCreateFolder('ClipSorter Library');
      this.googleApi.DRIVE_FOLDER_ID = folderId;

      // Step 2: Find or Create the Spreadsheet inside that folder
      const sheetId = await this.googleApi.findOrCreateSheet('ClipSorter Database', folderId);
      this.googleApi.SHEET_ID = sheetId;

      await this.fetchSheetData();
      this.showToast('Library loaded!', 'success');
    } catch (e) {
      console.error('Init error:', e);
      this.showToast('Setup failed: ' + e.message, 'error');
    }
  }

  setupEventListeners() {
    // Sidebar nav
    const modeUpload = document.getElementById('mode-upload');
    const modeFind = document.getElementById('mode-find');

    if (modeUpload) {
      modeUpload.addEventListener('click', () => this.showView('upload'));
    }
    if (modeFind) {
      modeFind.addEventListener('click', () => this.showView('find'));
    }

    // File Upload
    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');

    if (dropZone) {
      dropZone.addEventListener('click', () => fileInput.click());
      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('border-primary', 'bg-primary/5');
      });
      dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('border-primary', 'bg-primary/5');
      });
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('border-primary', 'bg-primary/5');
        const file = e.dataTransfer.files[0];
        if (file) this.handleFileUpload(file);
      });
    }

    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) this.handleFileUpload(file);
      });
    }

    // Cancel / New Upload
    document.getElementById('cancel-upload')?.addEventListener('click', () => this.resetUploadState());

    // Final Database Confirm
    document.getElementById('confirm-upload')?.addEventListener('click', () => this.processFinalUpload());

    // Search
    document.getElementById('find-btn')?.addEventListener('click', () => this.handleFind());
  }

  showView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById('view-' + viewId);
    if (target) target.classList.add('active');
    
    // Update sidebar active states
    const modeUpload = document.getElementById('mode-upload');
    const modeFind = document.getElementById('mode-find');
    
    if (viewId === 'upload') {
      modeUpload?.classList.add('bg-[#2a2a2b]', 'text-[#b9c8de]', 'border-[#b9c8de]');
      modeUpload?.classList.remove('text-[#c4c6cd]', 'border-transparent');
      modeFind?.classList.remove('bg-[#2a2a2b]', 'text-[#b9c8de]', 'border-[#b9c8de]');
      modeFind?.classList.add('text-[#c4c6cd]', 'border-transparent');
    } else {
      modeFind?.classList.add('bg-[#2a2a2b]', 'text-[#b9c8de]', 'border-[#b9c8de]');
      modeFind?.classList.remove('text-[#c4c6cd]', 'border-transparent');
      modeUpload?.classList.remove('bg-[#2a2a2b]', 'text-[#b9c8de]', 'border-[#b9c8de]');
      modeUpload?.classList.add('text-[#c4c6cd]', 'border-transparent');
    }
  }

  // --- Core Logic ---

  async fetchSheetData() {
    try {
      const data = await this.googleApi.getSheetData();
      this.sheetRows = data.values || [];
      
      // Keep or add header
      if (this.sheetRows.length === 0 || this.sheetRows[0][0] !== 'Filename') {
          await this.googleApi.appendSheetRow(['Filename', 'Mood', 'Action', 'Subject', 'Setting', 'Style', 'Drive Link']);
          this.sheetRows = [['Filename', 'Mood', 'Action', 'Subject', 'Setting', 'Style', 'Drive Link']];
      }

      // Fetch active files and filter orphaned spreadsheet rows
      const activeIds = await this.googleApi.getDriveFileIds();
      const linkIdx = this.sheetRows[0].indexOf('Drive Link');
      
      if (linkIdx > -1 && this.sheetRows.length > 1) {
          const validRows = this.sheetRows.slice(1).filter(row => {
              const link = row[linkIdx];
              if (!link) return false;
              const match = link.match(/\/d\/([a-zA-Z0-9-_]+)/);
              return match ? activeIds.has(match[1]) : false;
          });
          this.sheetRows = [this.sheetRows[0], ...validRows];
      }

      const count = this.sheetRows.length > 0 ? this.sheetRows.length - 1 : 0;
      document.getElementById('lib-count').textContent = `${count} clips in library`;
    } catch (e) {
      this.showToast('Failed to load library: ' + e.message, 'error');
    }
  }

  async handleFileUpload(file) {
    if (!file.type.startsWith('video/')) {
      this.showToast('Please select a video file.', 'warning');
      return;
    }

    this.uploadedFile = file;
    document.getElementById('drop-zone').classList.add('hidden');
    document.getElementById('preview-section').classList.remove('hidden');
    document.getElementById('gemini-loading').classList.remove('hidden');
    document.getElementById('tag-result').classList.add('hidden');

    const preview = document.getElementById('video-preview');
    preview.src = URL.createObjectURL(file);

    try {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      const loadingTextElem = document.getElementById('loading-text');
      if (loadingTextElem) {
          loadingTextElem.textContent = `Analyzing video (${sizeMB}MB)...`;
      }

      const filename = await this.geminiApi.analyzeVideo(file);
      
      document.getElementById('gemini-loading').classList.add('hidden');
      document.getElementById('tag-result').classList.remove('hidden');
      document.getElementById('generated-filename').value = filename;

    } catch (e) {
      this.showToast(e.message, 'error');
      this.resetUploadState();
    }
  }

  async processFinalUpload() {
    const newName = document.getElementById('generated-filename').value.trim();
    if (!newName) return;

    document.getElementById('tag-result').classList.add('hidden');
    document.getElementById('upload-loading').classList.remove('hidden');

    try {
      // Upload to Drive
      const driveInfo = await this.googleApi.uploadVideo(this.uploadedFile, newName);
      
      // Parse data for Sheet from filename
      // format: [mood]_[action]_[subject]_[setting]_[style].mp4
      const parts = newName.replace('.mp4', '').split('_');
      const rowData = [
        newName,
        parts[0] || 'Unknown',
        parts[1] || 'Unknown',
        parts[2] || 'Unknown',
        parts[3] || 'Unknown',
        parts[4] || 'Unknown',
        driveInfo.webViewLink
      ];

      await this.googleApi.appendSheetRow(rowData);
      
      this.showToast('Clip saved to library!', 'success');
      this.fetchSheetData(); // Refresh count
      this.resetUploadState();

    } catch (e) {
      this.showToast('Upload failed: ' + e.message, 'error');
      document.getElementById('tag-result').classList.remove('hidden');
      document.getElementById('upload-loading').classList.add('hidden');
    }
  }

  resetUploadState() {
    this.uploadedFile = null;
    document.getElementById('file-input').value = '';
    document.getElementById('drop-zone').classList.remove('hidden');
    document.getElementById('preview-section').classList.add('hidden');
    document.getElementById('gemini-loading').classList.add('hidden');
    document.getElementById('tag-result').classList.add('hidden');
    document.getElementById('upload-loading')?.classList.add('hidden');
    const preview = document.getElementById('video-preview');
    if (preview.src) URL.revokeObjectURL(preview.src);
    preview.src = '';
  }

  async handleFind() {
    const queryEl = document.getElementById('search-query') || document.getElementById('tweet-text');
    const query = queryEl ? queryEl.value.trim().toLowerCase() : '';
    const moodEl = document.getElementById('mood-filter');
    const mood = moodEl ? moodEl.value : 'Any';
    
    if (!query && mood === 'Any') {
      this.renderResults(this.sheetRows.slice(1));
      return;
    }

    this.showToast('Searching...', 'info');
    
    // Simple narrative filter
    const filtered = this.sheetRows.slice(1).filter(row => {
      const filename = (row[0] || '').toLowerCase();
      const rowMood = (row[1] || '').toLowerCase();
      
      const queryMatch = !query || filename.includes(query);
      const moodMatch = mood === 'Any' || rowMood === mood.toLowerCase();
      
      return queryMatch && moodMatch;
    });

    this.renderResults(filtered);
  }

  renderResults(results) {
    const container = document.getElementById('search-results');
    container.innerHTML = '';

    if (results.length === 0) {
      container.innerHTML = '<div class="col-span-full py-12 text-center text-on-surface-variant font-medium">No clips found matching your vibe.</div>';
      return;
    }

    results.forEach(row => {
      const data = {
        name: row[0] || '',
        mood: row[1] || '',
        action: row[2] || '',
        subject: row[3] || '',
        setting: row[4] || '',
        style: row[5] || '',
        link: row[6] || ''
      };

      const filename = data.name;
      const card = document.createElement('div');
      card.className = 'group bg-surface-container rounded-xl border border-outline-variant/10 overflow-hidden hover:border-primary/30 transition-all duration-500 hover:shadow-2xl hover:shadow-primary/5';
      
      let embedLink = '';
      let downloadLink = '';
      if (data.link) {
        const match = data.link.match(/\/d\/([a-zA-Z0-9-_]+)/);
        if (match) {
          embedLink = `https://drive.google.com/file/d/${match[1]}/preview`;
          downloadLink = `https://drive.google.com/uc?export=download&id=${match[1]}`;
        }
      }

      let tagsHtml = '';
      [data.mood, data.action, data.subject, data.setting, data.style].forEach(tag => {
        if (tag && tag !== 'Unknown') {
          tagsHtml += `<span class="px-2 py-0.5 bg-primary/5 text-primary rounded text-[10px] font-bold tracking-tight uppercase">${tag}</span>`;
        }
      });

      card.innerHTML = `
        <div class="aspect-video bg-black relative overflow-hidden">
            ${embedLink ? `<iframe src="${embedLink}" class="w-full h-full border-0 grayscale hover:grayscale-0 transition-all duration-700" allow="autoplay"></iframe>` : '<div class="w-full h-full flex items-center justify-center text-surface-variant"><span class="material-symbols-outlined text-4xl">broken_image</span></div>'}
        </div>
        <div class="p-5 flex flex-col h-[200px]">
            <h4 class="text-sm font-bold text-on-surface line-clamp-1 mb-3 group-hover:text-primary transition-colors font-inter tracking-tight">${filename}</h4>
            <div class="flex flex-wrap gap-1.5 mb-4">
                ${tagsHtml}
            </div>
            <div class="mt-auto flex gap-2 pt-4 border-t border-outline-variant/10">
                <button class="flex-1 flex items-center justify-center gap-2 bg-surface-container py-2.5 rounded hover:bg-surface-variant transition-colors text-[10px] font-bold uppercase tracking-widest text-on-surface copy-btn" data-fn="${filename}">
                    <span class="material-symbols-outlined text-sm">content_copy</span>
                    Copy
                </button>
                ${data.link ? `
                <a href="${data.link}" target="_blank" class="w-10 flex items-center justify-center bg-primary-container text-primary rounded hover:brightness-110 transition-all cursor-pointer" title="Open in Drive">
                    <span class="material-symbols-outlined text-sm">open_in_new</span>
                </a>
                <a href="${downloadLink}" class="w-10 flex items-center justify-center bg-primary text-on-primary rounded hover:brightness-110 transition-all cursor-pointer" title="Direct Download">
                    <span class="material-symbols-outlined text-sm">download</span>
                </a>
                ` : ''}
            </div>
        </div>
      `;

      container.appendChild(card);
    });

    // Copy handlers
    container.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        navigator.clipboard.writeText(btn.dataset.fn);
        this.showToast('Filename copied!', 'success');
      });
    });
  }

  showToast(msg, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `flex items-center gap-3 px-6 py-3.5 rounded-xl shadow-2xl backdrop-blur-md border ${
      type === 'success' ? 'bg-green-500/10 border-green-500/30 text-green-400' : 
      type === 'error' ? 'bg-red-500/10 border-red-500/30 text-red-400' : 
      type === 'warning' ? 'bg-amber-500/10 border-amber-500/30 text-amber-400' : 
      'bg-primary/10 border-primary/30 text-primary'
    } animate-slideIn`;
    
    const icon = type === 'success' ? 'check_circle' : 
                 type === 'error' ? 'error' : 
                 type === 'warning' ? 'warning' : 'info';

    toast.innerHTML = `
      <span class="material-symbols-outlined text-xl">${icon}</span>
      <span class="font-inter text-sm font-medium tracking-tight">${msg}</span>
    `;

    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('animate-slideOut');
      setTimeout(() => toast.remove(), 500);
    }, 4000);
  }
}

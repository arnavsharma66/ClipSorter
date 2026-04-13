class GeminiApiManager {
  constructor() {
    this.UPLOAD_BASE = 'https://generativelanguage.googleapis.com';
  }

  get API_KEY() {
    return localStorage.getItem('gemini_api_key');
  }

  _getGenerateUrl(model) {
    return `${this.UPLOAD_BASE}/v1beta/models/${model}:generateContent?key=${this.API_KEY}`;
  }

  async _getAvailableModels() {
    try {
      const res = await fetch(`${this.UPLOAD_BASE}/v1beta/models?key=${this.API_KEY}`);
      if (!res.ok) return ['gemini-1.5-flash', 'gemini-1.5-flash-8b']; // Fallback
      
      const data = await res.json();
      const models = data.models
        .filter(m => m.supportedGenerationMethods?.includes('generateContent') && m.name.includes('gemini'))
        .map(m => m.name.replace('models/', ''));
        
      // Prioritize 1.5 flash standard, 8b, then others
      return models.sort((a, b) => {
        if (a === 'gemini-1.5-flash') return -1;
        if (b === 'gemini-1.5-flash') return 1;
        if (a === 'gemini-1.5-flash-8b') return -1;
        if (b === 'gemini-1.5-flash-8b') return 1;
        return 0;
      });
    } catch(e) {
      return ['gemini-1.5-flash', 'gemini-1.5-flash-8b'];
    }
  }

  async _uploadVideo(file) {
    // Step 1: Start resumable upload
    const initUrl = `${this.UPLOAD_BASE}/upload/v1beta/files?key=${this.API_KEY}`;
    const initRes = await fetch(initUrl, {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': file.size.toString(),
        'X-Goog-Upload-Header-Content-Type': file.type,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ file: { display_name: file.name } })
    });

    if (!initRes.ok) {
      const errData = await initRes.json().catch(() => ({}));
      throw new Error('Upload init failed: ' + (errData.error?.message || initRes.status));
    }

    const uploadUrl = initRes.headers.get('X-Goog-Upload-URL');
    if (!uploadUrl) throw new Error('No upload URL returned from Gemini.');

    // Step 2: Upload the file bytes
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'upload, finalize',
        'X-Goog-Upload-Offset': '0',
        'Content-Type': file.type
      },
      body: file
    });

    if (!uploadRes.ok) {
      const errData = await uploadRes.json().catch(() => ({}));
      throw new Error('File upload failed: ' + (errData.error?.message || uploadRes.status));
    }

    const uploadData = await uploadRes.json();
    const geminiFile = uploadData.file;

    // Step 3: Wait for processing to complete
    let state = geminiFile.state;
    let fileInfo = geminiFile;
    let attempts = 0;
    while (state === 'PROCESSING' && attempts < 30) {
      await new Promise(r => setTimeout(r, 2000));
      const checkRes = await fetch(
        `${this.UPLOAD_BASE}/v1beta/${fileInfo.name}?key=${this.API_KEY}`
      );
      if (checkRes.ok) {
        fileInfo = await checkRes.json();
        state = fileInfo.state;
      }
      attempts++;
    }

    if (state !== 'ACTIVE') {
      throw new Error('Video processing failed or timed out. State: ' + state);
    }

    return fileInfo;
  }

  async analyzeVideo(file) {
    if (!this.API_KEY) {
      throw new Error('Please set your Gemini API Key in the sidebar settings first.');
    }

    // Auto-discover the models your key is allowed to use
    const availableModels = await this._getAvailableModels();

    // Upload file using the Files API
    const geminiFile = await this._uploadVideo(file);

    let lastError = null;
    for (const model of availableModels) {
      try {
        console.log(`[Gemini] Trying model: ${model}`);
        const response = await fetch(this._getGenerateUrl(model), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{
              parts: [
                { text: "Analyze this video clip and return ONLY a filename in this format: [mood]_[action]_[subject]_[setting]_[style].mp4. Example: cinematic_running_man_forest_dark.mp4. Do not include any other text." },
                { fileData: { mimeType: geminiFile.mimeType, fileUri: geminiFile.uri } }
              ]
            }]
          })
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          const errMsg = err.error?.message || `API Error: ${response.status}`;
          console.error(`[Gemini] Model ${model} failed (${response.status}):`, errMsg);
          
          if (response.status === 429) {
            lastError = new Error(`Rate limited on ${model}. Detail: ${errMsg}`);
            // If quota is literally 0, we should skip and try the next model
            continue;
          }
          lastError = new Error(`${model}: ${errMsg}`);
          continue;
        }

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (!text) {
          lastError = new Error('No analysis generated.');
          continue;
        }

        let filename = text.trim().replace(/```/g, '').replace(/\n/g, '').trim();
        if (!filename.endsWith('.mp4')) filename += '.mp4';

        return filename;

      } catch (e) {
        console.error(`[Gemini] Error with model ${model}:`, e);
        lastError = e;
      }
    }

    throw lastError || new Error('Video analysis failed with all available models.');
  }
}

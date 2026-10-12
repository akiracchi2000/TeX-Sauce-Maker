// --- Constants & Defaults ---
const APP_VERSION = 'v1.13.0';
const TAG_DICTIONARY_PATH = './math_tag_dictionary.json';
const STORAGE_KEY_PROMPTS = 'tex_sauce_prompts';
const STORAGE_KEY_API_KEY = 'tex_sauce_api_key';
const STOREAGE_KEY_SELECTED_PROMPT = 'tex_sauce_selected_prompt_id';
const STORAGE_KEY_MODEL_NAME = 'tex_sauce_model_name';
const STORAGE_KEY_SOUND_ENABLED = 'tex_sauce_sound_enabled';
const DEFAULT_GEMINI_MODEL = 'gemini-3.1-pro-preview';

const DEFAULT_PROMPTS = [
    {
        id: 'default-1',
        name: 'TeX Sauce 変換',
        content: `以下の複数の数式画像（1枚または複数枚）をすべて分析し、それらを順に結合して、ひとつのTeX Sauce形式のコードブロックを作成してください。
画像が複数ある場合は、画像1, 画像2...の内容を順番に出力してください。
出力はコードブロックのみを含めてください。解説は不要です。

フォーマット例:
\`\`\`texsauce
\\begin{document}
% 画像1の内容
...
% 画像2の内容
...
\\end{document}
\`\`\``
    },
    {
        id: 'default-2',
        name: '数式解説 (日本語)',
        content: `この画像の数式について、日本語で詳しく解説してください。
数式の意味、変数の定義、もしあれば解法の手順なども含めてください。`
    }
];

// --- State ---
let state = {
    prompts: [],
    selectedPromptId: null,
    apiKey: '',
    soundEnabled: true,
    inputMode: 'image',
    currentImages: [], // Array of { id, file, base64, mimeType }
    hasGenerated: false,
    receivedTikzCode: [], // Array of raw TikZ code strings received from Clear Maker 2
    tagDictionary: null
};

// --- DOM Elements ---
const dom = {
    settingsBtn: document.getElementById('settings-btn'),
    settingsModal: document.getElementById('settings-modal'),
    saveSettingsBtn: document.getElementById('save-settings-btn'),
    apiKeyInput: document.getElementById('api-key-input'),

    modelNameInput: document.getElementById('model-name-display'),
    soundEnabledCheck: document.getElementById('sound-enabled-check'),
    appVersionDisplay: document.getElementById('app-version'),
    headerVersionDisplay: document.getElementById('header-version'),

    managePromptsBtn: document.getElementById('manage-prompts-btn'),
    promptsModal: document.getElementById('prompts-modal'),
    promptList: document.getElementById('prompt-list'),
    newPromptBtn: document.getElementById('new-prompt-btn'),
    savePromptBtn: document.getElementById('save-prompt-btn'),
    deletePromptBtn: document.getElementById('delete-prompt-btn'),
    editPromptName: document.getElementById('edit-prompt-name'),
    editPromptContent: document.getElementById('edit-prompt-content'),

    exportPromptsBtn: document.getElementById('export-prompts-btn'),
    importPromptsBtn: document.getElementById('import-prompts-btn'),
    importPromptsInput: document.getElementById('import-prompts-input'),

    closeModalBtns: document.querySelectorAll('.close-modal-btn'),

    promptSelect: document.getElementById('prompt-select'),
    currentPromptDisplay: document.getElementById('current-prompt-display'),

    dropZone: document.getElementById('drop-zone'),
    fileInput: document.getElementById('file-input'),
    imagePreviewContainer: document.getElementById('image-preview-container'),
    imageModeBtn: document.getElementById('image-mode-btn'),
    codeModeBtn: document.getElementById('code-mode-btn'),
    imageInputPanel: document.getElementById('image-input-panel'),
    codeInputPanel: document.getElementById('code-input-panel'),
    sourceCodeInput: document.getElementById('source-code-input'),
    // previewImg/removeImgBtn removed as they generate dynamically

    generateBtn: document.getElementById('generate-btn'),
    outputCode: document.getElementById('output-code'),
    copyBtn: document.getElementById('copy-btn'),
    obsidianExportBtn: document.getElementById('obsidian-export-btn'),
    baseNameInput: document.getElementById('base-name-input'),
    additionalPromptInput: document.getElementById('additional-prompt-input'),
    regenerateBtn: document.getElementById('regenerate-btn'),
    loadingIndicator: document.getElementById('loading-indicator'),
    toast: document.getElementById('toast')
};

let outputEditor = null;

function initializeOutputEditor() {
    if (typeof CodeMirror === 'undefined') return;

    outputEditor = CodeMirror.fromTextArea(dom.outputCode, {
        mode: 'stex',
        theme: 'material-darker',
        lineNumbers: true,
        lineWrapping: true,
        indentUnit: 4,
        tabSize: 4,
        viewportMargin: Infinity
    });
}

function setOutputCode(text) {
    if (outputEditor) {
        outputEditor.setValue(text);
        outputEditor.clearHistory();
    } else {
        dom.outputCode.value = text;
    }
}

function getOutputCode() {
    return outputEditor ? outputEditor.getValue() : dom.outputCode.value;
}

// --- Initialization ---
async function init() {
    initializeOutputEditor();
    loadSettings();
    loadPrompts();
    await loadTagDictionary();
    renderPromptSelect();
    setupEventListeners();
    showVersion();

    // --- Clear Maker 2 連携: postMessage受信リスナー ---
    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'clear-maker-image') {
            const dataUrl = event.data.imageDataUrl;
            const mimeType = event.data.mimeType || 'image/png';

            // data:URLからbase64部分を抽出
            const base64Parts = dataUrl.split(',');
            if (base64Parts.length > 1) {
                // 前回の生成結果をクリア
                state.currentImages = [];
                state.hasGenerated = false;
                setInputMode('image');
                state.receivedTikzCode = event.data.tikzCodeArray || []; // TikZコード配列を受け取る
                setOutputCode('');
                dom.additionalPromptInput.value = '';

                addImageToState({
                    id: Date.now() + Math.random().toString(36).substring(2, 9),
                    file: null, // postMessage経由のためFileオブジェクトなし
                    base64: base64Parts[1],
                    mimeType: mimeType,
                    previewUrl: dataUrl
                });

                showToast('Clear Maker 2から画像を受信しました');
                console.log('[TeX連携] Clear Maker 2から画像を受信・読み込み完了');
            }
        }
    });

    // --- Clear Maker 2 連携: readyシグナル送信 ---
    // window.openerが存在する場合（Clear Maker 2から開かれた場合）readyを通知
    if (window.opener) {
        window.opener.postMessage({ type: 'tex-sauce-maker-ready' }, '*');
        console.log('[TeX連携] readyシグナルをClear Maker 2に送信しました');
    }
}

// --- Logic: Settings ---
function loadSettings() {
    const key = localStorage.getItem(STORAGE_KEY_API_KEY);
    if (key) {
        state.apiKey = key;
        dom.apiKeyInput.value = key;
    }

    // Display current model
    const savedModel = localStorage.getItem(STORAGE_KEY_MODEL_NAME);
    const migratedModel = savedModel === 'gemini-3.7-flash-preview'
        ? 'gemini-3.7-flash'
        : savedModel;
    const modelToUse = migratedModel || DEFAULT_GEMINI_MODEL;

    if (savedModel && savedModel !== modelToUse) {
        localStorage.setItem(STORAGE_KEY_MODEL_NAME, modelToUse);
    }

    state.modelName = modelToUse;
    if (dom.modelNameInput) {
        dom.modelNameInput.value = modelToUse;
    }

    // Sound settings
    const savedSound = localStorage.getItem(STORAGE_KEY_SOUND_ENABLED);
    // Default to true if not set
    state.soundEnabled = savedSound === null ? true : (savedSound === 'true');
    if (dom.soundEnabledCheck) {
        dom.soundEnabledCheck.checked = state.soundEnabled;
    }
}

function saveSettings() {
    const key = dom.apiKeyInput.value.trim();
    const modelName = dom.modelNameInput.value.trim();

    if (!key) {
        showToast('API Keyを入力してください');
        return;
    }

    state.apiKey = key;
    state.modelName = modelName || DEFAULT_GEMINI_MODEL;
    state.soundEnabled = dom.soundEnabledCheck.checked;

    localStorage.setItem(STORAGE_KEY_API_KEY, key);
    localStorage.setItem(STORAGE_KEY_MODEL_NAME, state.modelName);
    localStorage.setItem(STORAGE_KEY_SOUND_ENABLED, state.soundEnabled);

    closeModal(dom.settingsModal);
    checkGenerateButtonState();
    showToast('設定を保存しました');
}

function showVersion() {
    if (dom.appVersionDisplay) {
        dom.appVersionDisplay.textContent = APP_VERSION;
    }
    if (dom.headerVersionDisplay) {
        dom.headerVersionDisplay.textContent = APP_VERSION;
    }
}

async function loadTagDictionary() {
    try {
        const response = await fetch(TAG_DICTIONARY_PATH, { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const dictionary = await response.json();
        const hasValidTerms = Array.isArray(dictionary?.terms?.canonical)
            && Array.isArray(dictionary.terms.primary_candidates)
            && dictionary.terms.aliases
            && typeof dictionary.terms.aliases === 'object';
        const hasValidMethods = Array.isArray(dictionary?.methods?.canonical)
            && Array.isArray(dictionary.methods.primary_candidates)
            && dictionary.methods.aliases
            && typeof dictionary.methods.aliases === 'object';

        if (!hasValidTerms || !hasValidMethods) {
            throw new Error('辞書のterms/methods/primary_candidates形式が不正です');
        }

        state.tagDictionary = dictionary;
        console.log(
            `Tag dictionary loaded: ${dictionary.terms.canonical.length} terms, `
            + `${dictionary.methods.canonical.length} methods, `
            + `${dictionary.terms.primary_candidates.length} primary term candidates, `
            + `${dictionary.methods.primary_candidates.length} primary method candidates`
        );
    } catch (error) {
        state.tagDictionary = null;
        console.warn('Tag dictionary could not be loaded; tags will be exported unchanged.', error);
    }
}

// --- Logic: Prompts ---
function loadPrompts() {
    const saved = localStorage.getItem(STORAGE_KEY_PROMPTS);
    if (saved) {
        state.prompts = JSON.parse(saved);
    } else {
        state.prompts = JSON.parse(JSON.stringify(DEFAULT_PROMPTS));
        savePromptsToStorage();
    }

    const selectedId = localStorage.getItem(STOREAGE_KEY_SELECTED_PROMPT);
    if (selectedId && state.prompts.find(p => p.id === selectedId)) {
        state.selectedPromptId = selectedId;
    } else if (state.prompts.length > 0) {
        state.selectedPromptId = state.prompts[0].id;
    }
}

function savePromptsToStorage() {
    localStorage.setItem(STORAGE_KEY_PROMPTS, JSON.stringify(state.prompts));
}

let editingPromptId = null;

function renderPromptList() {
    dom.promptList.innerHTML = '';
    state.prompts.forEach(prompt => {
        const li = document.createElement('li');
        li.textContent = prompt.name;
        li.dataset.id = prompt.id;
        if (prompt.id === editingPromptId) {
            li.classList.add('selected');
        }
        li.addEventListener('click', () => selectPromptForEditing(prompt.id));
        dom.promptList.appendChild(li);
    });
}

function selectPromptForEditing(id) {
    editingPromptId = id;
    const prompt = state.prompts.find(p => p.id === id);
    if (prompt) {
        dom.editPromptName.value = prompt.name;
        dom.editPromptContent.value = prompt.content;
        renderPromptList(); // Update update selection style
    }
}

function startNewPrompt() {
    editingPromptId = null;
    dom.editPromptName.value = '';
    dom.editPromptContent.value = '';
    renderPromptList(); // Clear selection
    dom.editPromptName.focus();
}

function saveEditingPrompt() {
    const name = dom.editPromptName.value.trim();
    const content = dom.editPromptContent.value.trim();

    if (!name || !content) {
        showToast('名前と内容は必須です');
        return;
    }

    if (editingPromptId) {
        // Update existing
        const index = state.prompts.findIndex(p => p.id === editingPromptId);
        if (index !== -1) {
            state.prompts[index].name = name;
            state.prompts[index].content = content;
        }
    } else {
        // Create new
        const newId = 'prompt-' + Date.now();
        state.prompts.push({
            id: newId,
            name: name,
            content: content
        });
        editingPromptId = newId;
    }

    savePromptsToStorage();
    renderPromptList();
    renderPromptSelect(); // Update main UI dropdown
    showToast('プロンプトを保存しました');
}

function deleteEditingPrompt() {
    if (!editingPromptId) return;

    if (!confirm('本当にこのプロンプトを削除しますか？')) return;

    state.prompts = state.prompts.filter(p => p.id !== editingPromptId);
    savePromptsToStorage();
    startNewPrompt();
    renderPromptList();
    renderPromptSelect();
    showToast('削除しました');
}

function renderPromptSelect() {
    dom.promptSelect.innerHTML = '';
    state.prompts.forEach(prompt => {
        const option = document.createElement('option');
        option.value = prompt.id;
        option.textContent = prompt.name;
        dom.promptSelect.appendChild(option);
    });

    if (state.selectedPromptId) {
        dom.promptSelect.value = state.selectedPromptId;
    }

    updateCurrentPromptDisplay();
}

function updateCurrentPromptDisplay() {
    state.selectedPromptId = dom.promptSelect.value;
    localStorage.setItem(STOREAGE_KEY_SELECTED_PROMPT, state.selectedPromptId);

    const prompt = state.prompts.find(p => p.id === state.selectedPromptId);
    if (prompt) {
        dom.currentPromptDisplay.value = prompt.content;
    } else {
        dom.currentPromptDisplay.value = '';
    }
}

// --- Logic: Export/Import ---
function exportPrompts() {
    const dataStr = JSON.stringify(state.prompts, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

    const exportFileDefaultName = `tex_sauce_prompts_${new Date().toISOString().slice(0, 10)}.json`;

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
}

function importPrompts(file) {
    const reader = new FileReader();
    reader.onload = (event) => {
        try {
            const importedPrompts = JSON.parse(event.target.result);

            if (!Array.isArray(importedPrompts) || !importedPrompts.every(p => p.id && p.name && p.content)) {
                throw new Error('Invalid format');
            }

            // Ask user for merge strategy
            // Simplification: We will support "Replace" or "Append" via simple confirm/prompt?
            // User requested "load", usually means "open".
            // Let's use confirm: OK = Replace, Cancel = Append? No, that's confusing.
            // Let's use a custom approach or just confirm replacement.
            // Since we can't easily show a custom modal without more UI, let's use window.confirm for replacement.
            // But wait, user might want to merge.
            // Let's try to ask: "OK to Replace All, Cancel to Append"
            // "既存のプロンプトをすべて削除して置き換えますか？\n[OK]: 置き換え\n[キャンセル]: 追加 (既存のものは残ります)"

            if (confirm('既存のプロンプトをすべて削除して、読み込んだ内容で置き換えますか？\n\n[OK] = 置き換え (現在のプロンプトは消えます)\n[キャンセル] = 追加 (現在のプロンプトの後ろに追加されます)')) {
                // Replace
                state.prompts = importedPrompts;
                showToast('プロンプトを置き換えました');
            } else {
                // Append
                // Ensure IDs are unique to avoid conflict
                const importedWithNewIds = importedPrompts.map(p => ({
                    ...p,
                    id: 'imported-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5)
                }));
                state.prompts = [...state.prompts, ...importedWithNewIds];
                showToast('プロンプトを追加しました');
            }

            savePromptsToStorage();
            renderPromptList();
            renderPromptSelect();
            startNewPrompt(); // Reset editor

        } catch (e) {
            console.error(e);
            showToast('ファイルの読み込みに失敗しました。形式が正しいか確認してください。');
        }
    };
    reader.readAsText(file);
}


// --- Logic: Image Handling ---
function handleFileSelect(files) {
    if (!files || files.length === 0) return;

    // Convert FileList to Array
    const fileArray = Array.from(files);

    // Clear previous images if a generation has just finished
    if (state.hasGenerated) {
        // Clear state images
        state.currentImages = [];
        state.hasGenerated = false;
        state.receivedTikzCode = []; // Clear old TikZ hints
        // Update UI
        renderPreviews();
        setOutputCode('');
        dom.additionalPromptInput.value = ''; // Clear additional instructions
        dom.baseNameInput.value = ''; // Clear base name

        // "生成が終わった場合，次のドロップ時に前の画像を消去してほしい。" -> Clear previous image on next drop.
    }

    fileArray.forEach(file => {
        if (file.type === 'application/pdf') {
            processPdfFile(file);
        } else if (file.type.startsWith('image/')) {
            processImageFile(file);
        } else {
            showToast(`サポートされていないファイル形式です: ${file.name}`);
        }
    });

    // Reset input to allow selecting the same file again if needed (though difficult with multiple)
    // Actually better to keep it but we might need to clear it if we want to allow re-selecting same file after clearing.
    dom.fileInput.value = '';
}

function processImageFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const base64Parts = e.target.result.split(',');
        if (base64Parts.length > 1) {
            addImageToState({
                id: Date.now() + Math.random().toString(36).substring(2, 9),
                file: file,
                base64: base64Parts[1],
                mimeType: file.type,
                previewUrl: e.target.result
            });

            // Set default base name from file name
            if (dom.baseNameInput && !dom.baseNameInput.value) {
                dom.baseNameInput.value = file.name.replace(/\.[^/.]+$/, "");
            }
        }
    };
    reader.readAsDataURL(file);
}

async function processPdfFile(file) {
    try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        const page = await pdf.getPage(1); // Get first page

        const viewport = page.getViewport({ scale: 2.0 }); // Scale up for better quality
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({
            canvasContext: context,
            viewport: viewport
        }).promise;

        // Convert key information to state
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
        const base64Parts = dataUrl.split(',');

        if (base64Parts.length > 1) {
            addImageToState({
                id: Date.now() + Math.random().toString(36).substring(2, 9),
                file: file,
                base64: base64Parts[1],
                mimeType: 'image/jpeg', // Send as JPEG to API
                previewUrl: dataUrl
            });
            showToast(`PDF読み込み完了: ${file.name} (1ページ目)`);

            // Set default base name from file name
            if (dom.baseNameInput && !dom.baseNameInput.value) {
                dom.baseNameInput.value = file.name.replace(/\.[^/.]+$/, "");
            }
        }
    } catch (e) {
        console.error('PDF processing failed:', e);
        showToast('PDFの読み込みに失敗しました');
    }
}

function addImageToState(imageObj) {
    state.currentImages.push(imageObj);
    renderPreviews();
    checkGenerateButtonState();
}

function removeImage(id) {
    state.currentImages = state.currentImages.filter(img => img.id !== id);
    renderPreviews();
    checkGenerateButtonState();
}

function renderPreviews() {
    dom.imagePreviewContainer.innerHTML = '';

    if (state.currentImages.length === 0) {
        dom.imagePreviewContainer.classList.add('hidden');
        dom.dropZone.classList.remove('hidden');
        return;
    }

    dom.dropZone.classList.add('hidden');
    dom.imagePreviewContainer.classList.remove('hidden');

    state.currentImages.forEach(img => {
        const item = document.createElement('div');
        item.className = 'image-preview-item';

        const imgEl = document.createElement('img');
        imgEl.src = img.previewUrl;

        const removeBtn = document.createElement('button');
        removeBtn.className = 'remove-btn';
        removeBtn.innerHTML = '<span class="material-icons-round">close</span>';
        removeBtn.onclick = (e) => {
            e.stopPropagation(); // Prevent bubbling if needed
            removeImage(img.id);
        };

        item.appendChild(imgEl);
        item.appendChild(removeBtn);
        dom.imagePreviewContainer.appendChild(item);
    });
}


function checkGenerateButtonState(showKeyWarning = true) {
    const hasSource = state.inputMode === 'code'
        ? dom.sourceCodeInput.value.trim().length > 0
        : state.currentImages.length > 0;
    const canGenerate = state.apiKey && hasSource;
    dom.generateBtn.disabled = !canGenerate;
    dom.regenerateBtn.disabled = !canGenerate;

    if (showKeyWarning && !state.apiKey && hasSource) {
        showToast('設定からAPI Keyを入力してください');
    }
}

function setInputMode(mode) {
    state.inputMode = mode === 'code' ? 'code' : 'image';
    const isCodeMode = state.inputMode === 'code';

    dom.imageModeBtn.classList.toggle('active', !isCodeMode);
    dom.codeModeBtn.classList.toggle('active', isCodeMode);
    dom.imageModeBtn.setAttribute('aria-selected', String(!isCodeMode));
    dom.codeModeBtn.setAttribute('aria-selected', String(isCodeMode));
    dom.imageInputPanel.classList.toggle('hidden', isCodeMode);
    dom.codeInputPanel.classList.toggle('hidden', !isCodeMode);
    checkGenerateButtonState(false);

    if (isCodeMode) {
        dom.sourceCodeInput.focus();
    }
}

// --- Logic: Generation ---
async function generateContent(extraPrompt = null) {
    if (!state.apiKey) {
        openModal(dom.settingsModal);
        return;
    }

    const sourceCode = dom.sourceCodeInput.value.trim();
    if (state.inputMode === 'image' && state.currentImages.length === 0) return;
    if (state.inputMode === 'code' && !sourceCode) return;

    const prompt = state.prompts.find(p => p.id === state.selectedPromptId);
    if (!prompt) return;

    setLoading(true);
    setOutputCode('');
    dom.copyBtn.hidden = true;
    dom.obsidianExportBtn.hidden = true;

    try {
        // Use the edited content directly from the textarea
        let finalPromptContent = dom.currentPromptDisplay.value;

        if (state.inputMode === 'code') {
            finalPromptContent += `\n\n【入力形式について】\n上記の指示に「画像」とある場合は、以下の入力コードを問題文として読み替えてください。コードの内容を正確に読み取り、選択中の指示に従って解答を作成してください。\n\n【入力コード】\n${sourceCode}\n【入力コードここまで】`;
        }

        if (extraPrompt) {
            finalPromptContent += `\n\n【追加の指示】\n${extraPrompt}`;
        }

        // --- 連携された生のTikZコードが存在する場合はプロンプトに組み込む ---
        if (state.inputMode === 'image' && state.receivedTikzCode && state.receivedTikzCode.length > 0) {
            finalPromptContent += `\n\n【重要・グラフ描画の指示】\n以下のTikZコードは図形（グラフ等）の正確な描画データです。画像内のグラフ部分を出力する際は、画像から推測するのではなく、必ず以下のTikZコードをそのままコピーして組み込んでください。\n`;
            state.receivedTikzCode.forEach((code, index) => {
                finalPromptContent += `\n--- 図形${index + 1}のTikZコード ---\n${code}\n--------------------\n`;
            });
        }

        const images = state.inputMode === 'image' ? state.currentImages : [];
        const result = await callGeminiApi(finalPromptContent, images);

        // Extract content
        // Simple text extraction
        let text = result.candidates[0].content.parts[0].text;

        // Clean up markdown code blocks if present
        // Removes ```tex ... ``` or similar wrapper
        const codeBlockRegex = /^```[a-zA-Z]*\n([\s\S]*?)\n```$/;
        const match = text.trim().match(codeBlockRegex);
        if (match) {
            text = match[1];
        }

        setOutputCode(text);

        dom.copyBtn.hidden = false;
        dom.obsidianExportBtn.hidden = false;

        if (state.soundEnabled) {
            playSuccessSound();
        }

        state.hasGenerated = true;

    } catch (error) {
        console.error(error);
        setOutputCode('エラーが発生しました: ' + error.message);
        if (error.message.includes('401') || error.message.includes('INVALID_ARGUMENT')) {
            showToast('API Keyが無効の可能性があります');
        }
    } finally {
        setLoading(false);
    }
}



async function callGeminiApi(promptText, images) {
    const model = state.modelName || DEFAULT_GEMINI_MODEL;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${state.apiKey}`;

    const parts = [{ text: promptText }];

    // Add all images
    images.forEach(img => {
        parts.push({
            inline_data: {
                mime_type: img.mimeType,
                data: img.base64
            }
        });
    });

    const payload = {
        contents: [{
            parts: parts
        }],
        generationConfig: {
            temperature: 0.2,
        }
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || response.statusText);
    }

    return await response.json();
}

function setLoading(isLoading) {
    if (isLoading) {
        dom.generateBtn.disabled = true;
        dom.regenerateBtn.disabled = true;
        // dom.outputCode.parentElement.classList.add('hidden'); // Hide code box temporarily? Or just keep it and show logs? Let's hide code block and show spinner
        // Actually better to keep code box but clear it.
        dom.loadingIndicator.classList.remove('hidden');
    } else {
        dom.generateBtn.disabled = false;
        dom.regenerateBtn.disabled = false;
        dom.loadingIndicator.classList.add('hidden');
        dom.outputCode.parentElement.classList.remove('hidden');
    }
}

const DIFFICULTY_RUBRIC_VERSION = 'v0.2';
const DIFFICULTY_AXES = ['idea', 'steps', 'calc', 'guide'];

function clampAxisScore(value) {
    const n = Number.parseInt(value, 10);
    return Number.isFinite(n) ? Math.min(2, Math.max(0, n)) : null;
}

// 合計点(0〜8) → difficulty(1〜5)。境界を変えるときはこの表だけを直す
const LEVEL_BANDS = [
    { maxTotal: 1, level: 1 },
    { maxTotal: 3, level: 2 },
    { maxTotal: 5, level: 3 },
    { maxTotal: 6, level: 4 },
    { maxTotal: 8, level: 5 },
];

function scoreToLevel(total) {
    const band = LEVEL_BANDS.find(b => total <= b.maxTotal);
    return band ? band.level : LEVEL_BANDS[LEVEL_BANDS.length - 1].level;
}

// AIの前置き文（「以下に…作成します。」「ご指定のルールに基づいた…」など）と、思考ログの残り「thought」
const AI_PREAMBLE = /^(?:thought|(?:以下に|ご指定の|承知しました).*(?:作成|します|しました).*)$/;
const FENCE_LINE = /^\s*(?:```|~~~|''')/;

// 生成結果を正規化する：AIの前置き文を消し、''' を ``` に直し、重複した開始フェンスを1つにまとめる
function normalizeGeneratedMarkdown(text) {
    const out = [];
    let inside = false;     // コードブロックの中にいるか
    let justOpened = false; // 開始フェンスの直後で、まだ中身がないか
    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.replace(/^(\s*)'''\\?/, '$1```');
        if ((!inside || justOpened) && AI_PREAMBLE.test(line.trim())) continue;
        if (FENCE_LINE.test(line)) {
            if (inside && justOpened) continue; // 「```latex」が2行続く二重フェンスの2行目を捨てる
            inside = !inside;
            justOpened = inside;
            out.push(line);
            continue;
        }
        if (line.trim() !== '') justOpened = false;
        out.push(line);
    }
    return out.join('\n');
}

// 本解答だけを取り出す（別解・解法のポイント以降は除外）
function extractMainSolution(texSource) {
    const src = normalizeGeneratedMarkdown(texSource);
    let solution = '';
    // 1) 「### 解答」見出しがあれば、その後ろ（次の見出しまで）を解答とみなす
    const heading = src.match(/^#{1,6}\s*解答\s*$/m);
    if (heading) {
        solution = src.slice(heading.index + heading[0].length);
        const next = solution.search(/^#{1,6}\s/m);
        if (next >= 0) solution = solution.slice(0, next);
    }
    // 2) なければ、2つ目以降のコードブロックを解答とみなす
    if (!solution.trim()) {
        const fence = /^(?:```|~~~)[^\r\n]*\r?\n([\s\S]*?)^(?:```|~~~)[^\r\n]*$/gm;
        const blocks = [...src.matchAll(fence)].map(m => m[1]).filter(b => b.trim());
        solution = blocks.length >= 2 ? blocks.slice(1).join('\n') : '';
    }
    // 3) それもなければ「解答例」以降
    if (!solution.trim()) {
        const start = src.search(/解答例/);
        solution = start >= 0 ? src.slice(start) : '';
    }
    solution = solution.split('\n').filter(l => !FENCE_LINE.test(l)).join('\n');
    const cut = solution.search(/\\bekkai|別解|解法のポイント/);
    return cut >= 0 ? solution.slice(0, cut) : solution;
}

const MIN_SOLUTION_LINES = 3; // これ未満は抽出に失敗したとみなし、AIの値を使う

// 本解答の行数（LaTeXの改行 \\ の数）から手数を求める。取れなければ null
function stepsFromSolution(texSource) {
    const main = extractMainSolution(texSource);
    if (!main.trim()) return null;
    const lines = (main.match(/\\\\/g) || []).length;
    if (lines < MIN_SOLUTION_LINES) return null;
    if (lines <= 20) return 0;
    if (lines <= 45) return 1;
    return 2;
}

function computeDifficulty(detail, texSource) {
    const scores = {};
    for (const axis of DIFFICULTY_AXES) {
        scores[axis] = clampAxisScore(detail?.[axis]);
    }
    const computedSteps = stepsFromSolution(texSource);
    if (computedSteps !== null) {
        scores.steps = computedSteps;
    }
    // AIが返さなかった観点は1点（標準）として扱う
    for (const axis of DIFFICULTY_AXES) {
        if (scores[axis] === null) scores[axis] = 1;
    }
    const total = DIFFICULTY_AXES.reduce((sum, axis) => sum + scores[axis], 0);
    return { ...scores, total, level: scoreToLevel(total), rubric: DIFFICULTY_RUBRIC_VERSION };
}

function formatYamlListProperty(name, items) {
    const normalizedItems = items
        .map(item => String(item).replace(/\s+/g, ' ').trim())
        .filter(Boolean);

    if (!normalizedItems.length) {
        return `${name}: []`;
    }

    return `${name}:\n${normalizedItems
        .map(item => `  - ${item}`)
        .join('\n')}`;
}

function uniqueItems(items) {
    const seen = new Set();
    return items.filter(item => {
        const normalized = String(item).replace(/\s+/g, ' ').trim();
        if (!normalized || seen.has(normalized)) {
            return false;
        }
        seen.add(normalized);
        return true;
    });
}

function normalizeTagItems(items, category) {
    const cleaned = uniqueItems((Array.isArray(items) ? items : [])
        .map(item => String(item).replace(/\s+/g, ' ').trim())
        .filter(Boolean));
    const dictionarySection = state.tagDictionary?.[category];

    if (!dictionarySection) {
        return { items: cleaned, unknown: [] };
    }

    const aliases = dictionarySection.aliases || {};
    const canonicalSet = new Set(dictionarySection.canonical || []);
    const normalized = uniqueItems(cleaned.map(item => aliases[item] || item));
    const unknown = normalized.filter(item => !canonicalSet.has(item));

    return { items: normalized, unknown };
}

function normalizePrimaryTagItems(items, category) {
    const normalized = normalizeTagItems(items, category);
    const dictionarySection = state.tagDictionary?.[category];
    const canonicalSet = new Set(dictionarySection?.canonical || []);
    const primaryCandidateSet = new Set(dictionarySection?.primary_candidates || []);

    // primary_* は辞書の primary_candidates に存在する canonical タグだけを採用する。
    // 辞書を読み込めなかった場合は、通常タグと同様に値を保持する。
    const primaryItems = dictionarySection
        ? normalized.items.filter(item => canonicalSet.has(item) && primaryCandidateSet.has(item))
        : normalized.items;

    return { items: primaryItems, unknown: normalized.unknown };
}

function formatObsidianCodeSections(source) {
    // 言語名の有無や表記にかかわらず、Markdownのフェンスを抽出する。
    const fencedBlockPattern = /^(?:```|~~~)[^\r\n]*\r?\n([\s\S]*?)^(?:```|~~~)[^\r\n]*$/gm;
    const blocks = [...source.matchAll(fencedBlockPattern)]
        .map(match => match[1].trim())
        .filter(Boolean);

    // 生成結果の先頭フェンスだけが除去され、
    // 「1つ目の終了フェンス → 2つ目の開始フェンス」となる場合を補正する。
    if (blocks.length < 2) {
        const splitPattern = /^(?:```|~~~)[^\r\n]*\r?\n\s*^(?:```|~~~)[^\r\n]*\r?\n/m;
        const splitMatch = splitPattern.exec(source);

        if (splitMatch) {
            const firstBlock = source.slice(0, splitMatch.index).trim();
            const secondBlock = source.slice(splitMatch.index + splitMatch[0].length)
                .replace(/\r?\n?(?:```|~~~)\s*$/, '')
                .trim();

            if (firstBlock && secondBlock) {
                return `### TeXソース
\`\`\`latex
${firstBlock}
\`\`\`

### 解答
\`\`\`latex
${secondBlock}
\`\`\``;
            }
        }
    }

    if (blocks.length < 2) {
        return `### TeXソース
\`\`\`latex
${source}
\`\`\``;
    }

    const sections = [`### TeXソース
\`\`\`latex
${blocks[0]}
\`\`\``];

    blocks.slice(1).forEach(block => {
        // 「### 解答」は、必ず2回目以降の ```latex の直前に入れる。
        sections.push(`### 解答
\`\`\`latex
${block}
\`\`\``);
    });

    return sections.join('\n\n');
}

async function exportToObsidian() {
    const texSource = normalizeGeneratedMarkdown(getOutputCode());
    if (!texSource) {
        showToast('TeXソースがありません');
        return;
    }

    if (!state.apiKey) {
        openModal(dom.settingsModal);
        return;
    }

    setLoading(true);
    try {
        const metadataPrompt = `以下のTeXソースを解析し、以下の情報をJSON形式で返してください。
1. 文章内の用語 (terms)
2. 文章内の中心的な用語 (primary_terms)
3. 解法の用語 (methods)
4. 解答で中心となる解法 (primary_methods)
5. 分野の用語 (fields: 数学I, 数学A, 数学II, 数学B, 数学III, 数学C などの大項目)
6. 難易度の観点別点数 (difficulty_detail)

難易度は、問題の中で最も難しい小問（1つ）を対象に、次の観点をそれぞれ0、1、2の整数で採点してください。
問題文だけでなく、生成済みの解答の内容も参照してください。
- idea（着想）: 0=公式・定理の直接の当てはめ / 1=典型テクニック1つ（軸の場合分け、置換、次数下げ、余事象、方べき、部分分数など） / 2=複数手法の組み合わせ、または問題文にない気付きが必要
- steps（手数）: 最難小問の本解答の長さ。0=短い / 1=中程度 / 2=長い（別解は数えない）
- calc（計算量）: 0=軽い / 1=根号・分数・文字係数を含む / 2=重くてミスしやすい
- guide（誘導）: 0=前の小問の結果をそのまま使える。小問が1つの問題では、問題文が方針を指定しているか公式を当てはめるだけ / 1=誘導はあるが方針を自分で立てる部分が残る。小問が1つの問題では、典型的な方針を自分で選ぶ必要がある / 2=方針を自分で組み立てる必要がある、または誘導のない証明が問題の本質
注意:
- 分野名や単元名（数III、確率、複素数平面、整数など）だけを理由に点を上げないでください。
- 典型的な場合分けはidea=1です。場合分けがあることだけでidea=2にしないでください。
- 教科書の例題にある型なら、手順が長くてもideaは1以下です。
- 「証明せよ」とあるだけでguide=2にしないでください。定石どおりに進めればよい証明はguide=1です。
- hardest_part には対象にした小問番号（例: "(3)"）、reason には採点の理由を1文で入れてください。

採点の基準例（idea / calc / guide）:
- x^100 を x^2+x+1 で割った余り → 0 / 0 / 0
- 0≦x≦2 のすべての x で ax^2+3>x+2a となる a の条件 → 0 / 1 / 1
- f(θ)=2(cos^3θ+sin^3θ)=a の解が3個または4個となる a の範囲 → 1 / 1 / 1
- -1≦x≦1 で |ax^2+bx+c|≦1 ならば |2ax+b|≦4 を示せ → 2 / 0 / 2
- 曲線 y=x^3+ax^2 上の点 P(u,v)（-1<u<1）を通る傾き b の直線が、どの u でも P 以外の共有点をもつ (a,b) の範囲 → 2 / 1 / 2
- a_1=0, a_n=[(a_{n-1}+k)/3] で定まる数列が単調で上に有界であり、やがて一定になることを示す → 2 / 1 / 2

primary_termsはtermsから、primary_methodsはmethodsから、問題の主題や解法を代表するものだけを選んでください。
primary_termsとprimary_methodsに新しい表記を作らず、対応するtermsまたはmethodsの値を完全に同じ表記で入れてください。

JSONフォーマット:
{
  "terms": ["用語1", "用語2"],
  "primary_terms": ["用語1"],
  "methods": ["手法1", "手法2"],
  "primary_methods": ["手法1"],
  "fields": ["分野1"],
  "difficulty_detail": { "idea": 1, "steps": 1, "calc": 1, "guide": 1, "hardest_part": "(3)", "reason": "軸と定義域の典型的な場合分け" }
}

TeXソース:
${texSource}`;

        const metadataResponse = await callGeminiApiForMetadata(metadataPrompt);
        const metadata = JSON.parse(metadataResponse);

        // baseName取得
        let baseName = dom.baseNameInput.value.trim() || 'output';

        const normalizedTerms = normalizeTagItems(metadata.terms, 'terms');
        const normalizedMethods = normalizeTagItems(metadata.methods, 'methods');
        const normalizedPrimaryTerms = normalizePrimaryTagItems(metadata.primary_terms, 'terms');
        const normalizedPrimaryMethods = normalizePrimaryTagItems(metadata.primary_methods, 'methods');
        const primaryTerms = normalizedPrimaryTerms.items;
        const primaryMethods = normalizedPrimaryMethods.items;
        // primary_* が必ず対応する全タグの部分集合になるよう、不足分を全タグへ補う。
        const terms = uniqueItems([...normalizedTerms.items, ...primaryTerms]);
        const methods = uniqueItems([...normalizedMethods.items, ...primaryMethods]);
        const fields = (metadata.fields || []).filter(Boolean);
        const unknownTags = uniqueItems([
            ...normalizedTerms.unknown,
            ...normalizedMethods.unknown,
            ...normalizedPrimaryTerms.unknown,
            ...normalizedPrimaryMethods.unknown
        ]);
        if (unknownTags.length) {
            console.warn('Tag dictionaryに未登録のタグ:', unknownTags);
        }
        const tags = uniqueItems([...terms, ...methods, ...fields]);
        const difficultyResult = computeDifficulty(metadata.difficulty_detail, texSource);
        const difficulty = difficultyResult.level;
        const difficultyLabel = '★'.repeat(difficulty);
        console.info('difficulty', difficultyResult, metadata.difficulty_detail?.hardest_part, metadata.difficulty_detail?.reason);
        const codeSections = formatObsidianCodeSections(texSource);

        const mdContent = `---
type: problem
unit: ""
difficulty: ${difficulty}
difficulty_label: ${difficultyLabel}
difficulty_score: ${difficultyResult.total}
difficulty_idea: ${difficultyResult.idea}
difficulty_steps: ${difficultyResult.steps}
difficulty_calc: ${difficultyResult.calc}
difficulty_guide: ${difficultyResult.guide}
difficulty_rubric: ${difficultyResult.rubric}
${formatYamlListProperty('terms', terms)}
${formatYamlListProperty('primary_terms', primaryTerms)}
${formatYamlListProperty('methods', methods)}
${formatYamlListProperty('primary_methods', primaryMethods)}
${formatYamlListProperty('fields', fields)}
${formatYamlListProperty('tags', tags)}
---

### TeXコード

[[${baseName}.tex]]

### PDF

![[${baseName}.pdf]]

${codeSections}
`;

        const saved = await downloadFile(`${baseName}.md`, mdContent);
        if (saved) {
            const suffix = unknownTags.length ? `（未登録タグ ${unknownTags.length}件）` : '';
            showToast(`Obsidian用.mdを書き出しました${suffix}`);
        }

    } catch (error) {
        console.error('Obsidian export failed:', error);
        showToast('変換に失敗しました: ' + error.message);
    } finally {
        setLoading(false);
    }
}

async function callGeminiApiForMetadata(promptText) {
    const model = 'gemini-3-flash-preview'; // User requested this
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${state.apiKey}`;

    const payload = {
        contents: [{
            parts: [{ text: promptText }]
        }],
        generationConfig: {
            temperature: 0.1,
            response_mime_type: "application/json",
        }
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || response.statusText);
    }

    const data = await response.json();
    return data.candidates[0].content.parts[0].text;
}

async function downloadFile(filename, content) {
    // Chrome/Edgeなどで利用可能な File System Access API を優先
    if ('showSaveFilePicker' in window) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: filename,
                types: [{
                    description: 'Markdown File',
                    accept: { 'text/markdown': ['.md'] },
                }],
            });
            const writable = await handle.createWritable();
            await writable.write(content);
            await writable.close();
            return true;
        } catch (err) {
            // ユーザーがキャンセルした場合は何もしない
            if (err.name === 'AbortError') return false;
            console.warn('File System Access API failed, falling back:', err);
        }
    }

    // 従来のダウンロード方式（SafariやFirefox、またはAPIエラー時のフォールバック）
    const element = document.createElement('a');
    element.setAttribute('href', 'data:text/markdown;charset=utf-8,' + encodeURIComponent(content));
    element.setAttribute('download', filename);
    element.style.display = 'none';
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
    return true;
}





function applyCustomHighlighting(element) {
    // Traverse text nodes to replace specific patterns without breaking HTML
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null, false);
    const nodesToReplace = [];

    // Collect all text nodes first
    while (walker.nextNode()) {
        nodesToReplace.push(walker.currentNode);
    }

    nodesToReplace.forEach(node => {
        const text = node.nodeValue;
        // Check if text handles characters we want to color
        // Check if text handles characters we want to color
        if (text.match(/(\\[a-zA-Z]+|\$|\{|\})/)) {
            const span = document.createElement('span');

            // Regex explanation:
            // (\\[a-zA-Z]+) -> Capture LaTeX commands
            // (\$)          -> Capture $
            // (\{)          -> Capture {
            // (\})          -> Capture }
            // Split by these groups, keeping delimiters
            const parts = text.split(/(\\[a-zA-Z]+|\$|\{|\})/g);

            parts.forEach(part => {
                if (part.startsWith('\\')) {
                    const s = document.createElement('span');
                    s.className = 'syntax-blue';
                    s.textContent = part;
                    span.appendChild(s);
                } else if (part === '$' || part === '{' || part === '}') {
                    const s = document.createElement('span');
                    s.className = 'syntax-red';
                    s.textContent = part;
                    span.appendChild(s);
                } else {
                    span.appendChild(document.createTextNode(part));
                }
            });

            node.parentNode.replaceChild(span, node);
        }
    });
}


// --- Logic: UI Utilities ---
function openModal(modal) {
    modal.classList.remove('hidden');
}

function closeModal(modal) {
    modal.classList.add('hidden');
}

function showToast(message) {
    dom.toast.textContent = message;
    dom.toast.classList.remove('hidden');
    // Animation is handled by CSS, but we need to remove the class after it finishes to be able to trigger it again properly?
    // Actually the CSS animation uses @keyframes. 
    // To re-trigger, we'd need to remove and add class.
    // For simplicity, just setTimeout to hide.
    setTimeout(() => {
        dom.toast.classList.add('hidden');
    }, 3000);

}

// --- Logic: Sound ---
function playSuccessSound() {
    try {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;

        const ctx = new AudioContext();
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, ctx.currentTime); // High A (A5)
        oscillator.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.5); // Drop to A4

        gainNode.gain.setValueAtTime(0.1, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);

        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.start();
        oscillator.stop(ctx.currentTime + 0.5);
    } catch (e) {
        console.warn('Sound playback failed:', e);
    }
}


// --- Event Listeners ---
function setupEventListeners() {
    // Buttons
    dom.settingsBtn.addEventListener('click', () => openModal(dom.settingsModal));
    dom.managePromptsBtn.addEventListener('click', () => {
        if (!editingPromptId && state.prompts.length > 0) {
            selectPromptForEditing(state.prompts[0].id);
        } else if (state.prompts.length === 0) {
            startNewPrompt();
        }
        renderPromptList();
        openModal(dom.promptsModal);
    });

    dom.closeModalBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            closeModal(e.target.closest('.modal'));
        });
    });
    // Close modal on outside click
    window.addEventListener('click', (e) => {
        if (e.target.classList.contains('modal')) {
            closeModal(e.target);
        }
    });

    dom.saveSettingsBtn.addEventListener('click', saveSettings);

    dom.promptSelect.addEventListener('change', updateCurrentPromptDisplay);

    dom.imageModeBtn.addEventListener('click', () => setInputMode('image'));
    dom.codeModeBtn.addEventListener('click', () => setInputMode('code'));
    dom.sourceCodeInput.addEventListener('input', () => {
        if (state.hasGenerated) {
            state.hasGenerated = false;
            setOutputCode('');
            dom.additionalPromptInput.value = '';
            dom.copyBtn.hidden = true;
            dom.obsidianExportBtn.hidden = true;
        }
        checkGenerateButtonState(false);
    });

    dom.generateBtn.addEventListener('click', () => {
        const extraPrompt = dom.additionalPromptInput.value.trim();
        generateContent(extraPrompt);
    });

    dom.regenerateBtn.addEventListener('click', () => {
        const extraPrompt = dom.additionalPromptInput.value.trim();
        generateContent(extraPrompt);
    });

    dom.copyBtn.addEventListener('click', () => {
        const text = getOutputCode();
        navigator.clipboard.writeText(text).then(() => {
            showToast('コピーしました');
        });
    });

    dom.obsidianExportBtn.addEventListener('click', exportToObsidian);


    // Auto-Save Prompt Edit
    let autoSaveTimeout;
    dom.currentPromptDisplay.addEventListener('input', () => {
        if (!state.selectedPromptId) return;

        const content = dom.currentPromptDisplay.value;
        const promptIndex = state.prompts.findIndex(p => p.id === state.selectedPromptId);

        if (promptIndex !== -1) {
            // Update state immediately
            state.prompts[promptIndex].content = content;

            // Debounce save to storage
            clearTimeout(autoSaveTimeout);
            autoSaveTimeout = setTimeout(() => {
                savePromptsToStorage();
                // Optional: visual indicator e.g. "Saved" in corner
            }, 500);
        }
    });

    // Prompt Management
    dom.newPromptBtn.addEventListener('click', startNewPrompt);
    dom.savePromptBtn.addEventListener('click', saveEditingPrompt);
    dom.deletePromptBtn.addEventListener('click', deleteEditingPrompt);

    // Export/Import Events
    dom.exportPromptsBtn.addEventListener('click', exportPrompts);
    dom.importPromptsBtn.addEventListener('click', () => dom.importPromptsInput.click());
    dom.importPromptsInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
            importPrompts(e.target.files[0]);
            e.target.value = ''; // Reset for re-selection
        }
    });

    // Drag & Drop
    dom.dropZone.addEventListener('click', () => dom.fileInput.click());
    dom.fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) handleFileSelect(e.target.files);
    });

    dom.dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dom.dropZone.classList.add('dragover');
    });

    dom.dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dom.dropZone.classList.remove('dragover');
    });

    dom.dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dom.dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handleFileSelect(e.dataTransfer.files);
        }
    });

    // dom.removeImgBtn.addEventListener('click', clearImage); // Removed single btn listener

    // Paste support
    window.addEventListener('paste', (e) => {
        if (state.inputMode !== 'image') return;
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (const item of items) {
            if (item.kind === 'file') {
                if (item.type.startsWith('image/') || item.type === 'application/pdf') {
                    const file = item.getAsFile();
                    // Wrap in FileList-like object or array
                    handleFileSelect([file]);
                    e.preventDefault();
                    // break; // Removed to allow multiple images
                }
            }
        }
    });
}

// Start
init().catch(error => {
    console.error('Initialization failed:', error);
});

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((registration) => {
            registration.update();
            console.log('ServiceWorker registration successful with scope: ', registration.scope);
        }).catch((err) => {
            console.log('ServiceWorker registration failed: ', err);
        });
    });
}

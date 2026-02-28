// --- Constants & Defaults ---
const APP_VERSION = 'v1.6.2';
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
    currentImages: [], // Array of { id, file, base64, mimeType }
    hasGenerated: false
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
    // previewImg/removeImgBtn removed as they generate dynamically

    generateBtn: document.getElementById('generate-btn'),
    outputCode: document.getElementById('output-code'),
    copyBtn: document.getElementById('copy-btn'),
    additionalPromptInput: document.getElementById('additional-prompt-input'),
    regenerateBtn: document.getElementById('regenerate-btn'),
    loadingIndicator: document.getElementById('loading-indicator'),
    toast: document.getElementById('toast')
};

// --- Initialization ---
function init() {
    loadSettings();
    loadPrompts();
    renderPromptSelect();
    setupEventListeners();
    showVersion();
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
    const modelToUse = savedModel || DEFAULT_GEMINI_MODEL;

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
        // Update UI
        renderPreviews();
        dom.outputCode.textContent = '';
        dom.additionalPromptInput.value = ''; // Clear additional instructions

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


function checkGenerateButtonState() {
    const canGenerate = state.apiKey && state.currentImages.length > 0;
    dom.generateBtn.disabled = !canGenerate;
    dom.regenerateBtn.disabled = !canGenerate;

    if (!state.apiKey && state.currentImages.length > 0) {
        showToast('設定からAPI Keyを入力してください');
    }
}

// --- Logic: Generation ---
async function generateContent(extraPrompt = null) {
    if (!state.apiKey) {
        openModal(dom.settingsModal);
        return;
    }

    if (state.currentImages.length === 0) return;

    const prompt = state.prompts.find(p => p.id === state.selectedPromptId);
    if (!prompt) return;

    setLoading(true);
    dom.outputCode.textContent = '';
    dom.copyBtn.hidden = true;

    try {
        // Use the edited content directly from the textarea
        let finalPromptContent = dom.currentPromptDisplay.value;

        if (extraPrompt) {
            finalPromptContent += `\n\n【追加の指示】\n${extraPrompt}`;
        }

        const result = await callGeminiApi(finalPromptContent, state.currentImages);

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

        dom.outputCode.textContent = text;
        dom.outputCode.className = 'language-latex'; // Default to latex
        hljs.highlightElement(dom.outputCode);
        applyCustomHighlighting(dom.outputCode);

        dom.copyBtn.hidden = false;

        if (state.soundEnabled) {
            playSuccessSound();
        }

        state.hasGenerated = true;

    } catch (error) {
        console.error(error);
        dom.outputCode.textContent = 'エラーが発生しました: ' + error.message;
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

    dom.generateBtn.addEventListener('click', () => {
        const extraPrompt = dom.additionalPromptInput.value.trim();
        generateContent(extraPrompt);
    });

    dom.regenerateBtn.addEventListener('click', () => {
        const extraPrompt = dom.additionalPromptInput.value.trim();
        generateContent(extraPrompt);
    });

    dom.copyBtn.addEventListener('click', () => {
        const text = dom.outputCode.textContent;
        navigator.clipboard.writeText(text).then(() => {
            showToast('コピーしました');
        });
    });

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
init();

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').then((registration) => {
      console.log('ServiceWorker registration successful with scope: ', registration.scope);
    }).catch((err) => {
      console.log('ServiceWorker registration failed: ', err);
    });
  });
}

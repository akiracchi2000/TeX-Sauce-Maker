(() => {
    const button = document.getElementById('obsidian-batch-btn');
    const dialog = document.getElementById('obsidian-batch-dialog');
    const folderButton = document.getElementById('obsidian-folder-btn');
    const folderLabel = document.getElementById('obsidian-folder-label');
    const rows = document.getElementById('obsidian-batch-rows');
    const message = document.getElementById('obsidian-batch-status');
    const runButton = document.getElementById('obsidian-batch-run');
    const saveButton = document.getElementById('obsidian-batch-save');
    const closeButton = document.getElementById('obsidian-batch-close');
    const selectedTypes = new Map();
    let root;
    let jobs = [];
    let occupied = new Map();
    let folders = [];
    let busy = false;

    async function rememberFolder(handle) {
        const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('tex-sauce-obsidian', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('settings');
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        try {
            return await new Promise((resolve, reject) => {
                const transaction = db.transaction('settings', handle ? 'readwrite' : 'readonly');
                const settings = transaction.objectStore('settings');
                const request = handle ? settings.put(handle, 'vault') : settings.get('vault');
                transaction.oncomplete = () => resolve(request.result);
                transaction.onabort = () => reject(transaction.error);
            });
        } finally {
            db.close();
        }
    }

    function updateFolderLabel() {
        folderLabel.textContent = root ? root.name : '未選択';
    }

    const restoredFolder = rememberFolder().then(handle => {
        root = handle;
        updateFolderLabel();
    }).catch(() => {});

    folderButton.onclick = async () => {
        try {
            root = await window.showDirectoryPicker({ mode: 'readwrite', id: 'math-obsidian-vault' });
            updateFolderLabel();
            await rememberFolder(root);
            await scanVault();
            for (const job of jobs) {
                for (const problem of job.problems) {
                    if (problem.saved) continue;
                    problem.customName = '';
                    problem.folder = isObsidianClassification(problem.course, problem.unit)
                        ? suggestedFolder(problem.unit) : '';
                }
            }
            render();
            message.textContent = '';
        } catch (error) {
            if (error.name !== 'AbortError') message.textContent = error.message;
        }
    };

    async function scanVault() {
        const nextOccupied = new Map();
        const nextFolders = [];
        async function scan(directory, topLevel) {
            for await (const entry of directory.values()) {
                if (entry.name.startsWith('.')) continue;
                if (entry.kind === 'directory') {
                    if (topLevel) nextFolders.push(entry.name);
                    await scan(entry, false);
                } else {
                    const parsed = parseObsidianName(entry.name);
                    if (!parsed) continue;
                    if (!nextOccupied.has(parsed.key)) nextOccupied.set(parsed.key, new Set());
                    nextOccupied.get(parsed.key).add(parsed.serial);
                }
            }
        }
        await scan(root, true);
        occupied = nextOccupied;
        folders = nextFolders.sort((a, b) => a.localeCompare(b, 'ja'));
    }

    function labelForFolder(name) {
        return name.normalize('NFKC').replace(/\s/g, '').replace(/^二次/, '2次');
    }

    function suggestedFolder(unit) {
        const label = obsidianUnits[Number(unit) - 1];
        const matches = folders.filter(name => labelForFolder(name) === labelForFolder(label));
        if (matches.length > 1) return '';
        return matches[0] || label;
    }

    function collectNames() {
        const maximums = new Map();
        for (const [key, serials] of occupied) {
            let maximum = 0;
            for (const serial of serials) maximum = Math.max(maximum, serial);
            maximums.set(key, maximum);
        }
        for (const job of jobs) {
            for (const problem of job.problems) {
                problem.suggestedName = '';
                if (problem.saved || !isObsidianClassification(problem.course, problem.unit)) continue;
                const key = `${job.type}-${problem.course}-${problem.unit}`;
                const serial = (maximums.get(key) || 0) + 1;
                maximums.set(key, serial);
                problem.suggestedName = `${String(serial).padStart(4, '0')}-${key}.md`;
            }
        }
    }

    function createSelect(labelText, options, value, onChange) {
        const label = document.createElement('label');
        label.textContent = labelText + ' ';
        const select = document.createElement('select');
        for (const [code, title] of options) select.add(new Option(title, code));
        select.value = value;
        select.onchange = () => onChange(select.value);
        label.append(select);
        return label;
    }

    function refreshNames() {
        collectNames();
        for (const job of jobs) {
            for (const problem of job.problems) {
                if (problem.nameInput) problem.nameInput.value = problem.customName || problem.suggestedName;
            }
        }
    }

    function renderProblem(job, problem, index) {
        const box = document.createElement('fieldset');
        const heading = document.createElement('legend');
        heading.textContent = `第${index + 1}問${problem.saved ? '（保存済み）' : ''}`;
        box.append(heading);
        if (problem.question) {
            const question = document.createElement('p');
            question.textContent = '要確認 — ' + problem.question;
            box.append(question);
            const acknowledge = document.createElement('label');
            const checked = document.createElement('input');
            checked.type = 'checkbox';
            checked.checked = problem.resolved;
            checked.onchange = () => { problem.resolved = checked.checked; };
            acknowledge.append(checked, ' 確認・修正済み');
            box.append(acknowledge);
        }
        const classificationChanged = () => {
            problem.customName = '';
            problem.folder = isObsidianClassification(problem.course, problem.unit)
                ? suggestedFolder(problem.unit) : '';
            render();
        };
        box.append(
            createSelect('科目', [['', '選択してください'], ...obsidianCourses], problem.course, value => {
                problem.course = value;
                classificationChanged();
            }),
            createSelect('単元', [['', '選択してください'], ...obsidianUnits.map((label, i) => [String(i + 1), label])],
                problem.unit, value => {
                    problem.unit = value;
                    classificationChanged();
                }),
        );
        const folderOptions = new Set(folders);
        if (problem.folder) folderOptions.add(problem.folder);
        const defaultFolder = isObsidianClassification(problem.course, problem.unit) && suggestedFolder(problem.unit);
        if (defaultFolder) folderOptions.add(defaultFolder);
        box.append(createSelect('保存先', [['', '選択してください'], ...[...folderOptions].map(name => [name, folders.includes(name) ? name : name + '（新規フォルダ）'])],
            problem.folder, value => { problem.folder = value; }));

        const nameLabel = document.createElement('label');
        nameLabel.textContent = 'ファイル名 ';
        const nameInput = document.createElement('input');
        nameInput.type = 'text';
        nameInput.value = problem.saved || problem.customName || problem.suggestedName;
        nameInput.onchange = () => { problem.customName = nameInput.value.trim(); };
        problem.nameInput = problem.saved ? null : nameInput;
        nameLabel.append(nameInput);

        const texLabel = document.createElement('label');
        texLabel.textContent = 'TeX ';
        const tex = document.createElement('textarea');
        tex.rows = 6;
        tex.spellcheck = false;
        tex.value = problem.tex;
        tex.oninput = () => { problem.tex = tex.value; };
        texLabel.append(tex);
        box.append(nameLabel, texLabel);
        box.disabled = Boolean(problem.saved);
        return box;
    }

    function render() {
        collectNames();
        rows.replaceChildren();
        jobs.forEach((job, index) => {
            const group = document.createElement('section');
            group.className = 'obsidian-batch-image';
            const image = document.createElement('img');
            image.src = job.image.previewUrl;
            image.alt = `元画像 ${index + 1}`;
            const problemList = document.createElement('div');
            const typeSelect = createSelect('問題種別', [['', '選択してください'],
                ...[...obsidianTypes].map(([code, label]) => [code, `${code}（${label}）`])], job.type, value => {
                job.type = value;
                selectedTypes.set(job.image.id, value);
                for (const problem of job.problems) problem.customName = '';
                refreshNames();
            });
            typeSelect.querySelector('select').disabled = job.problems.some(problem => problem.saved);
            problemList.append(typeSelect);
            if (index === 0 && jobs.length > 1 && !jobs.some(item => item.problems.some(problem => problem.saved))) {
                const apply = document.createElement('button');
                apply.type = 'button';
                apply.className = 'secondary-btn';
                apply.textContent = 'この種別を全画像に設定';
                apply.onclick = () => {
                    if (!job.type) return;
                    for (const item of jobs) {
                        item.type = job.type;
                        selectedTypes.set(item.image.id, job.type);
                        for (const problem of item.problems) problem.customName = '';
                    }
                    render();
                };
                problemList.append(apply);
            }
            if (job.error) {
                const error = document.createElement('p');
                error.textContent = job.error;
                problemList.append(error);
            }
            job.problems.forEach((problem, problemIndex) => problemList.append(renderProblem(job, problem, problemIndex)));
            group.append(image, problemList);
            rows.append(group);
        });
        runButton.hidden = jobs.every(job => job.problems.length);
        runButton.textContent = jobs.some(job => job.error) ? '失敗した画像を再処理' : 'Obsidian書き出し';
        saveButton.hidden = !jobs.some(job => job.problems.some(problem => !problem.saved));
    }

    function setBusy(value) {
        busy = value;
        rows.inert = value;
        for (const control of [folderButton, runButton, saveButton, closeButton]) control.disabled = value;
    }

    button.onclick = async () => {
        if (!window.showDirectoryPicker || !navigator.locks) {
            showToast('ローカル保存にはPC版のChromeまたはEdgeを使用してください');
            return;
        }
        if (!state.currentImages.length || state.inputMode !== 'image') {
            showToast('問題の画像を取り込んでください');
            return;
        }
        if (!state.apiKey) {
            openModal(dom.settingsModal);
            return;
        }
        await restoredFolder;
        const existing = new Map(jobs.map(job => [job.image.id, job]));
        jobs = state.currentImages.map(image => existing.get(image.id) || {
            image, type: selectedTypes.get(image.id) || '', problems: [],
        });
        message.textContent = '';
        render();
        if (!dialog.open) dialog.showModal();
    };

    runButton.onclick = async () => {
        if (!root || jobs.some(job => !job.type)) {
            message.textContent = '保管フォルダと、すべての画像の問題種別を指定してください。';
            return;
        }
        const prompt = dom.currentPromptDisplay.value;
        setBusy(true);
        try {
            if (await root.requestPermission({ mode: 'readwrite' }) !== 'granted') {
                throw new Error('保管フォルダへのアクセスを許可してください。');
            }
            await scanVault();
            for (const [index, job] of jobs.entries()) {
                if (job.problems.length) continue;
                message.textContent = `画像 ${index + 1} / ${jobs.length} を処理中…`;
                try {
                    const result = await callGeminiApi(prompt + '\n\n' + obsidianClassificationPrompt(),
                        [job.image], { responseMimeType: 'application/json' });
                    const parts = result.candidates?.[0]?.content?.parts;
                    const text = parts?.filter(part => !part.thought).map(part => part.text || '').join('');
                    const { problems } = JSON.parse(text);
                    if (!Array.isArray(problems) || !problems.length) throw new Error('問題を読み取れませんでした');
                    job.problems = problems.map(item => {
                        const tex = typeof item.tex === 'string' ? item.tex : '';
                        const course = String(item.course ?? '').trim().toLowerCase();
                        const unit = String(item.unit ?? '').trim();
                        const valid = isObsidianClassification(course, unit);
                        const question = String(item.question ?? '').trim() ||
                            (!valid || !tex.trim() ? '元画像を確認し、分類またはTeXを入力してください。' : '');
                        return { tex, course, unit, question, resolved: !question, folder: valid ? suggestedFolder(unit) : '' };
                    });
                    job.error = '';
                } catch (error) {
                    job.error = `画像の処理に失敗しました — ${error.message}`;
                }
            }
            message.textContent = '一覧を確認し、必要な箇所を修正してください。';
        } catch (error) {
            message.textContent = error.message;
        } finally {
            render();
            setBusy(false);
        }
    };

    function validatedEntries() {
        const entries = [];
        const claimed = new Set();
        for (const job of jobs) {
            for (const problem of job.problems) {
                if (problem.saved || !problem.resolved || !isObsidianClassification(problem.course, problem.unit)
                    || !problem.folder || !problem.tex.trim()) continue;
                const name = problem.customName || problem.suggestedName;
                const key = `${job.type}-${problem.course}-${problem.unit}`;
                const parsed = parseObsidianName(name);
                if (!parsed || name !== `${String(parsed.serial).padStart(4, '0')}-${key}.md`) {
                    throw new Error(`ファイル名を確認してください — ${name}`);
                }
                if (occupied.get(key)?.has(parsed.serial) || claimed.has(`${key}:${parsed.serial}`)) {
                    throw new Error(`同じ分類に使用済みの番号があります — ${name}`);
                }
                claimed.add(`${key}:${parsed.serial}`);
                entries.push({ problem, name, key, serial: parsed.serial });
            }
        }
        return entries;
    }

    saveButton.onclick = async () => {
        setBusy(true);
        let saved = 0;
        try {
            if (await root.requestPermission({ mode: 'readwrite' }) !== 'granted') {
                throw new Error('保管フォルダへのアクセスを許可してください。');
            }
            const entries = validatedEntries();
            if (!entries.length) throw new Error('保存できる行がありません。「要確認」の行を修正してください。');
            const prepared = [];
            for (const [index, entry] of entries.entries()) {
                message.textContent = `ノートの準備中 ${index + 1} / ${entries.length}…`;
                const { mdContent } = await buildObsidianMarkdown(
                    normalizeGeneratedMarkdown(entry.problem.tex), entry.name.slice(0, -3));
                prepared.push({ ...entry, mdContent });
            }
            await navigator.locks.request('tex-sauce-obsidian-write', async () => {
                await scanVault();
                for (const { key, serial, name } of entries) {
                    if (occupied.get(key)?.has(serial)) {
                        throw new Error(`保存前に番号の重複を検出しました。更新後の一覧を確認してください — ${name}`);
                    }
                }
                for (const { problem, name, mdContent } of prepared) {
                    const folder = await root.getDirectoryHandle(problem.folder, { create: true });
                    try {
                        await folder.getFileHandle(name);
                        throw new Error(`同名のノートがあります — ${name}`);
                    } catch (error) {
                        if (error.name !== 'NotFoundError') throw error;
                    }
                    const file = await folder.getFileHandle(name, { create: true });
                    const writable = await file.createWritable({ mode: 'exclusive' });
                    try {
                        await writable.write(mdContent);
                        await writable.close();
                    } catch (error) {
                        await writable.abort().catch(() => {});
                        throw error;
                    }
                    problem.saved = name;
                    const parsed = parseObsidianName(name);
                    if (!occupied.has(parsed.key)) occupied.set(parsed.key, new Set());
                    occupied.get(parsed.key).add(parsed.serial);
                    saved++;
                }
            });
            const pending = jobs.reduce((count, job) => count + (job.problems.length
                ? job.problems.filter(problem => !problem.saved).length : 1), 0);
            message.textContent = `${saved}件を保存しました。${pending ? `保留 ${pending}件（未処理の画像を含む）` : ''}`;
        } catch (error) {
            message.textContent = (saved ? `${saved}件を保存済み。 ` : '') + error.message;
        } finally {
            render();
            setBusy(false);
        }
    };

    closeButton.onclick = () => dialog.close();
    dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); });
})();

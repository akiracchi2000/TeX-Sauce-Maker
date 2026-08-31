const fs = require('fs');
const path = require('path');

function parseArgs(argv) {
    const args = { write: false, target: '', dictionary: '', backup: '' };
    for (let i = 2; i < argv.length; i += 1) {
        const arg = argv[i];
        if (arg === '--write') args.write = true;
        else if (arg === '--target') args.target = argv[++i] || '';
        else if (arg === '--dictionary') args.dictionary = argv[++i] || '';
        else if (arg === '--backup') args.backup = argv[++i] || '';
        else throw new Error(`Unknown argument: ${arg}`);
    }
    if (!args.target || !args.dictionary) {
        throw new Error('Usage: node rebuild_primary_tags.js --target DIR --dictionary FILE [--write --backup FILE]');
    }
    if (args.write && !args.backup) {
        throw new Error('--backup is required with --write');
    }
    return args;
}

function walkMarkdownFiles(root) {
    const files = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        const fullPath = path.join(root, entry.name);
        if (entry.isDirectory()) files.push(...walkMarkdownFiles(fullPath));
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) files.push(fullPath);
    }
    return files;
}

function frontmatterInfo(text) {
    const newline = text.includes('\r\n') ? '\r\n' : '\n';
    const bom = text.startsWith('\uFEFF') ? '\uFEFF' : '';
    const cleanText = bom ? text.slice(1) : text;
    const lines = cleanText.split(/\r?\n/);
    if (lines[0] !== '---') return null;
    const end = lines.indexOf('---', 1);
    if (end < 0) return null;
    return { bom, newline, lines, end };
}

function scalarValue(lines, end, key) {
    const prefix = `${key}:`;
    for (let i = 1; i < end; i += 1) {
        if (lines[i].startsWith(prefix)) return lines[i].slice(prefix.length).trim();
    }
    return '';
}

function listRange(lines, end, key) {
    const keyLine = lines.findIndex((line, index) => index > 0 && index < end && line === `${key}:`);
    if (keyLine < 0) return null;
    let after = keyLine + 1;
    while (after < end && /^(?:  )?-\s+/.test(lines[after])) after += 1;
    return { start: keyLine, after };
}

function listValue(lines, end, key) {
    const range = listRange(lines, end, key);
    if (!range) {
        const inline = scalarValue(lines, end, key);
        return inline === '[]' || !inline ? [] : [inline];
    }
    return lines.slice(range.start + 1, range.after)
        .map(line => line.replace(/^(?:  )?-\s+/, '').trim())
        .filter(Boolean);
}

function replaceList(lines, end, key, values, insertAfterKey) {
    const replacement = values.length
        ? [`${key}:`, ...values.map(value => `  - ${value}`)]
        : [`${key}: []`];
    const range = listRange(lines, end, key);
    if (range) {
        lines.splice(range.start, range.after - range.start, ...replacement);
        return end + replacement.length - (range.after - range.start);
    }

    const inlineIndex = lines.findIndex((line, index) => index > 0 && index < end && line.startsWith(`${key}:`));
    if (inlineIndex >= 0) {
        lines.splice(inlineIndex, 1, ...replacement);
        return end + replacement.length - 1;
    }

    const anchor = listRange(lines, end, insertAfterKey);
    const insertAt = anchor ? anchor.after : end;
    lines.splice(insertAt, 0, ...replacement);
    return end + replacement.length;
}

function countOccurrences(haystack, needle) {
    if (!needle) return 0;
    let count = 0;
    let at = 0;
    while ((at = haystack.indexOf(needle, at)) >= 0) {
        count += 1;
        at += needle.length;
    }
    return count;
}

function hasProperty(lines, end, key) {
    return lines.some((line, index) => index > 0 && index < end && line.startsWith(`${key}:`));
}

function normalizeItems(items, dictionarySection) {
    const aliases = dictionarySection.aliases || {};
    const canonical = new Set(dictionarySection.canonical || []);
    const normalized = [];
    const seen = new Set();
    const converted = [];
    const unknown = [];

    for (const item of items) {
        const cleaned = String(item).replace(/\s+/g, ' ').trim();
        if (!cleaned) continue;
        const value = aliases[cleaned] || cleaned;
        if (value !== cleaned) converted.push({ from: cleaned, to: value });
        if (!canonical.has(value)) unknown.push(value);
        if (!seen.has(value)) {
            seen.add(value);
            normalized.push(value);
        }
    }

    return { items: normalized, converted, unknown };
}

function normalizeLooseTags(items, dictionary) {
    const termAliases = dictionary.terms.aliases || {};
    const methodAliases = dictionary.methods.aliases || {};
    const termCanonical = new Set(dictionary.terms.canonical || []);
    const methodCanonical = new Set(dictionary.methods.canonical || []);
    const normalized = [];
    const converted = [];
    const seen = new Set();

    for (const item of items) {
        const cleaned = String(item).replace(/\s+/g, ' ').trim();
        if (!cleaned) continue;
        const termValue = termAliases[cleaned] || (termCanonical.has(cleaned) ? cleaned : null);
        const methodValue = methodAliases[cleaned] || (methodCanonical.has(cleaned) ? cleaned : null);
        let value = cleaned;
        // 名前空間を特定できる場合だけ変換し、terms/methods間で曖昧なら元表記を保持する。
        if (termValue && !methodValue) value = termValue;
        else if (methodValue && !termValue) value = methodValue;
        else if (termValue && methodValue && termValue === methodValue) value = termValue;
        if (value !== cleaned) converted.push({ from: cleaned, to: value });
        if (!seen.has(value)) {
            seen.add(value);
            normalized.push(value);
        }
    }

    return { items: normalized, converted };
}

function uniqueItems(items) {
    const seen = new Set();
    return items.filter(item => {
        const value = String(item).replace(/\s+/g, ' ').trim();
        if (!value || seen.has(value)) return false;
        seen.add(value);
        return true;
    });
}

function addNameCounts(target, values) {
    for (const value of values) target[value] = (target[value] || 0) + 1;
}

function choosePrimary(items, dictionarySection, context) {
    const canonical = new Set(dictionarySection.canonical || []);
    const candidates = new Set(dictionarySection.primary_candidates || []);
    const usage = dictionarySection.primary_usage_count || {};

    const eligible = [];
    const seen = new Set();
    items.forEach((value, index) => {
        if (seen.has(value) || !canonical.has(value) || !candidates.has(value)) return;
        seen.add(value);
        const bodyHits = Math.min(5, countOccurrences(context.body, value));
        const pathHits = context.relativePath.includes(value) ? 1 : 0;
        const positionScore = Math.max(0, items.length - index) * 2;
        const usageScore = Math.log2(1 + Number(usage[value] || 0)) * 2;
        const score = pathHits * 18 + bodyHits * 5 + positionScore + usageScore;
        eligible.push({ value, score, index });
    });

    const desiredCount = eligible.length <= 2
        ? eligible.length
        : Math.min(4, Math.max(2, Math.ceil(eligible.length / 2)));

    return eligible
        .sort((a, b) => b.score - a.score || a.index - b.index || a.value.localeCompare(b.value, 'ja'))
        .slice(0, desiredCount)
        .map(item => item.value);
}

function arraysEqual(a, b) {
    return a.length === b.length && a.every((value, index) => value === b[index]);
}

function incrementCount(map, count) {
    map[count] = (map[count] || 0) + 1;
}

function main() {
    const args = parseArgs(process.argv);
    const target = path.resolve(args.target);
    const dictionary = JSON.parse(fs.readFileSync(path.resolve(args.dictionary), 'utf8').replace(/^\uFEFF/, ''));
    const files = walkMarkdownFiles(target);
    const backups = [];
    const updates = [];
    const samples = [];
    const stats = {
        markdownFiles: files.length,
        problemNotes: 0,
        changed: 0,
        unchanged: 0,
        bothMultiple: 0,
        primaryTerms: {},
        primaryMethods: {},
        noPrimaryTermCandidates: [],
        noPrimaryMethodCandidates: [],
        termAliasConversions: 0,
        methodAliasConversions: 0,
        tagAliasConversions: 0,
        termDuplicatesRemoved: 0,
        methodDuplicatesRemoved: 0,
        notesWithTermsChanged: 0,
        notesWithMethodsChanged: 0,
        notesWithFieldsChanged: 0,
        notesWithTagsChanged: 0,
        notesWithPrimaryTermsChanged: 0,
        notesWithPrimaryMethodsChanged: 0,
        unknownTerms: {},
        unknownMethods: {}
    };

    for (const file of files) {
        const original = fs.readFileSync(file, 'utf8');
        const info = frontmatterInfo(original);
        if (!info || scalarValue(info.lines, info.end, 'type') !== 'problem') continue;
        stats.problemNotes += 1;

        const hasTerms = hasProperty(info.lines, info.end, 'terms');
        const hasMethods = hasProperty(info.lines, info.end, 'methods');
        const hasFields = hasProperty(info.lines, info.end, 'fields');
        const hasTags = hasProperty(info.lines, info.end, 'tags');
        const rawTerms = listValue(info.lines, info.end, 'terms');
        const rawMethods = listValue(info.lines, info.end, 'methods');
        const rawFields = listValue(info.lines, info.end, 'fields');
        const rawTags = listValue(info.lines, info.end, 'tags');
        const normalizedTerms = normalizeItems(rawTerms, dictionary.terms);
        const normalizedMethods = normalizeItems(rawMethods, dictionary.methods);
        const categorizedRawTags = new Set([...rawTerms, ...rawMethods, ...rawFields]
            .map(item => String(item).replace(/\s+/g, ' ').trim()));
        const rawExtraTags = rawTags.filter(item => !categorizedRawTags.has(String(item).replace(/\s+/g, ' ').trim()));
        const normalizedLooseTags = normalizeLooseTags(rawExtraTags, dictionary);
        const terms = normalizedTerms.items;
        const methods = normalizedMethods.items;
        const fields = uniqueItems(rawFields);
        const categorizedTags = new Set([...terms, ...methods, ...fields]);
        const extraTags = normalizedLooseTags.items.filter(item => !categorizedTags.has(item));
        const tags = uniqueItems([...terms, ...methods, ...fields, ...extraTags]);
        const oldPrimaryTerms = listValue(info.lines, info.end, 'primary_terms');
        const oldPrimaryMethods = listValue(info.lines, info.end, 'primary_methods');
        const body = info.lines.slice(info.end + 1).join('\n');
        const relativePath = path.relative(target, file);
        const context = { body, relativePath };
        const primaryTerms = choosePrimary(terms, dictionary.terms, context);
        const primaryMethods = choosePrimary(methods, dictionary.methods, context);

        stats.termAliasConversions += normalizedTerms.converted.length;
        stats.methodAliasConversions += normalizedMethods.converted.length;
        stats.tagAliasConversions += normalizedLooseTags.converted.length;
        stats.termDuplicatesRemoved += Math.max(0, rawTerms.length - terms.length);
        stats.methodDuplicatesRemoved += Math.max(0, rawMethods.length - methods.length);
        addNameCounts(stats.unknownTerms, normalizedTerms.unknown);
        addNameCounts(stats.unknownMethods, normalizedMethods.unknown);
        if (!arraysEqual(rawTerms, terms)) stats.notesWithTermsChanged += 1;
        if (!arraysEqual(rawMethods, methods)) stats.notesWithMethodsChanged += 1;
        if (!arraysEqual(rawFields, fields)) stats.notesWithFieldsChanged += 1;
        if (!arraysEqual(rawTags, tags)) stats.notesWithTagsChanged += 1;
        if (!arraysEqual(oldPrimaryTerms, primaryTerms)) stats.notesWithPrimaryTermsChanged += 1;
        if (!arraysEqual(oldPrimaryMethods, primaryMethods)) stats.notesWithPrimaryMethodsChanged += 1;

        incrementCount(stats.primaryTerms, primaryTerms.length);
        incrementCount(stats.primaryMethods, primaryMethods.length);
        if (primaryTerms.length >= 2 && primaryMethods.length >= 2) stats.bothMultiple += 1;
        if (primaryTerms.length === 0) stats.noPrimaryTermCandidates.push(relativePath);
        if (primaryMethods.length === 0) stats.noPrimaryMethodCandidates.push(relativePath);

        let end = info.end;
        if (hasTerms) end = replaceList(info.lines, end, 'terms', terms, 'difficulty_label');
        if (hasMethods) end = replaceList(info.lines, end, 'methods', methods, 'terms');
        end = replaceList(info.lines, end, 'primary_terms', primaryTerms, 'terms');
        end = replaceList(info.lines, end, 'primary_methods', primaryMethods, 'methods');
        if (hasFields) end = replaceList(info.lines, end, 'fields', fields, 'primary_methods');
        if (hasTags) end = replaceList(info.lines, end, 'tags', tags, 'fields');
        const updated = info.bom + info.lines.join(info.newline);
        const changed = updated !== original;

        if (changed) {
            stats.changed += 1;
            backups.push({ path: relativePath, contentBase64: Buffer.from(original, 'utf8').toString('base64') });
            updates.push({ file, updated });
            if (samples.length < 12 && (
                normalizedTerms.converted.length
                || normalizedMethods.converted.length
                || !arraysEqual(rawTerms, terms)
                || !arraysEqual(rawMethods, methods)
                || !arraysEqual(rawTags, tags)
                || !arraysEqual(oldPrimaryTerms, primaryTerms)
                || !arraysEqual(oldPrimaryMethods, primaryMethods)
            )) {
                samples.push({
                    path: relativePath,
                    termConversions: normalizedTerms.converted,
                    methodConversions: normalizedMethods.converted,
                    oldTags: rawTags,
                    tags,
                    oldPrimaryTerms,
                    primaryTerms,
                    oldPrimaryMethods,
                    primaryMethods
                });
            }
        } else {
            stats.unchanged += 1;
        }
    }

    if (args.write) {
        const backupPayload = {
            createdAt: new Date().toISOString(),
            target,
            dictionary: path.resolve(args.dictionary),
            files: backups
        };
        fs.writeFileSync(path.resolve(args.backup), JSON.stringify(backupPayload, null, 2), 'utf8');
        for (const update of updates) fs.writeFileSync(update.file, update.updated, 'utf8');
    }

    process.stdout.write(`${JSON.stringify({ mode: args.write ? 'write' : 'dry-run', stats, samples }, null, 2)}\n`);
}

main();

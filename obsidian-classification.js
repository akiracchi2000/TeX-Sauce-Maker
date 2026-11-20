// Math_obsidian/ファイル名ルール.pdfのコード表と、問題単位の分類方針。
const obsidianTypes = new Map([
    ['SK', '進研模試'], ['KK', '啓林館共通テスト対策'], ['KD', '基本大全'],
    ['TR', '鉄緑会'], ['LN', 'Learns入試問題'], ['SA', 'StudyAid'],
    ['KB', '河合塾難関大文系数学'], ['JN', '城南2019'], ['AO', 'AIオリジナル'],
    ['IL', 'IRLテキスト'], ['TB', '東進難関大文系数学'], ['TRB', '鉄緑会文系直前教材'],
]);
const obsidianCourses = new Map([
    ['0', '融合'], ['1', '数学I'], ['2', '数学II'], ['3', '数学III'],
    ['a', '数学A'], ['b', '数学B'], ['c', '数学C'],
]);
const obsidianUnits = [
    '小問集合', '中問集合', '数と式', '2次関数', '図形と計量', 'データの分析',
    '場合の数', '確率', '図形の性質', '整数の性質', '集合と命題', '式と証明',
    '複素数と方程式', '図形と方程式', '三角関数', '指数関数・対数関数',
    '微分法・積分法', '数列', '統計的な推測', 'ベクトル', '複素数平面', '平面上の曲線',
    '関数', '極限', '微分法(III)', '積分法(III)',
];
const obsidianCourseForUnit = [
    '', '', '1', '1', '1', '1', 'a', 'a', 'a', 'a', '1', '2', '2',
    '2', '2', '2', '2', 'b', 'b', 'c', 'c', 'c', '3', '3', '3', '3',
];

function isObsidianClassification(course, unit) {
    return obsidianCourses.has(course) && /^[1-9][0-9]*$/.test(unit)
        && Number(unit) <= obsidianUnits.length;
}

function obsidianClassificationPrompt() {
    return `画像中の独立した問題を掲載順に分割する。共通の問題文や図を使う小問は同じ問題に含める。
各問題について選択済みの指示に従ったTeX出力全体を作成し、設問の主題で分類する。
科目コード: ${[...obsidianCourses].map(([code, label]) => code + '=' + label).join(', ')}
単元番号: ${obsidianUnits.map((label, i) => (i + 1) + '=' + label +
    (obsidianCourseForUnit[i] ? '（科目' + obsidianCourseForUnit[i] + '）' : '')).join(', ')}
小問集合・中問集合は問題の構成で選ぶ。融合は独立した複数分野が主題で単一の科目にできない集合問題に使う。
分類や分割の判断に迷う場合は推測で確定せず、questionに具体的な理由と候補を含む質問を書く。
確定できないコードは空文字列にする。問題が読み取れない場合も内容を補わず、questionで確認する。
この追加指示は出力形式に優先する。JSONのみを返す。
形式: {"problems":[{"tex":"問題と解答のTeX出力全体","course":"2","unit":"15","question":""}]}`;
}

function parseObsidianName(name) {
    const match = /^(\d{4,})[-－ー]([A-Z]+)[-－ー](?:[1-4][-－ー])?([0123abc])[-－ー](\d+)\.(?:md|tex|pdf)$/i.exec(name);
    if (!match) return null;
    const [, digits, type, course, unit] = match;
    const serial = Number(digits);
    if (!Number.isSafeInteger(serial) || serial < 1) return null;
    return { key: `${type.toUpperCase()}-${course.toLowerCase()}-${Number(unit)}`, serial };
}

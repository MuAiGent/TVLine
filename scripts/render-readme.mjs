import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';

const catalog = JSON.parse(readFileSync(new URL('../sources.json', import.meta.url), 'utf8'));
const readme = new URL('../README.md', import.meta.url);
const labels = { green: '🟢 绿色', yellow: '🟡 黄色', red: '🔴 红色', gray: '⚪ 灰色' };
const formats = { 'maccms-json': 'MacCMS JSON', 'maccms-xml': 'MacCMS XML' };
const date = value => new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai', dateStyle: 'short', timeStyle: 'short',
}).format(new Date(value));
const cell = value => String(value).replace(/[\r\n]+/g, ' ').replace(/[&<>|`]/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '|': '&#124;', '`': '&#96;',
})[char]);

assert.equal(catalog.schemaVersion, 1);
assert(Number.isFinite(Date.parse(catalog.lastFullCheckAt)));
assert(Array.isArray(catalog.sources) && catalog.sources.length > 0);
const ids = new Set();
const endpoints = new Set();
for (const source of catalog.sources) {
  assert(/^[a-z][a-z0-9_-]{1,63}$/.test(source.id) && !ids.has(source.id), '片源 ID 重复或无效');
  assert(typeof source.name === 'string' && source.name.trim(), `${source.id} 缺少名称`);
  assert(Object.hasOwn(formats, source.format), `${source.id} 格式无效`);
  const url = new URL(source.url);
  assert(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.hash
    && /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(url.hostname) && !isIP(url.hostname)
    && !/\.(localhost|local|internal|lan|test|invalid|example|onion|nip\.io|sslip\.io|xip\.io)$/.test(url.hostname)
    && !/token|secret|passw(?:ord|d)|api[-_]?key|signature|session/i.test(url.pathname)
    && [...url.searchParams].every(([key, value]) => key === 'ac' && value === 'list'), `${source.id} 地址不适合公开`);
  const endpoint = `${source.format}:${url.href.replace(/\/+$/, '')}`;
  assert(!endpoints.has(endpoint), `${source.id} 地址重复`);
  assert(Number.isInteger(source.passed) && Number.isInteger(source.total)
    && source.passed >= 0 && source.passed <= source.total, `${source.id} 样本统计无效`);
  assert(source.checkedAt === null ? source.total === 0 : Number.isFinite(Date.parse(source.checkedAt)), `${source.id} 复测时间无效`);
  const ratio = source.total === 0 ? 0 : source.passed / source.total;
  const color = ratio >= 0.9 ? 'green' : ratio >= 0.6 ? 'yellow' : ratio > 0 ? 'red' : 'gray';
  assert.equal(source.status, color, `${source.id} 状态与通过率不符`);
  assert(typeof source.note === 'string' && Array.isArray(source.origins)
    && source.origins.every(origin => /^[\w.-]+\/[\w.-]+$/.test(origin)), `${source.id} 备注或出处无效`);
  ids.add(source.id);
  endpoints.add(endpoint);
}

const groups = Object.fromEntries(Object.keys(labels).map(color => [color, []]));
for (const source of catalog.sources) groups[source.status].push(source);
const table = sources => [
  '| 状态 | 片源 | 格式 | 接口 | 样本 | 最后复测（北京时间） | 备注 | 出处 |',
  '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ...sources.map(s => [labels[s.status], cell(s.name), formats[s.format], `\`${cell(s.url)}\``,
    s.total ? `${s.passed}/${s.total}` : '未复测', s.checkedAt ? date(s.checkedAt) : '—',
    cell(s.note || '—'), s.origins.length ? s.origins.map(repo => `[${repo}](https://github.com/${repo})`).join('、') : '—',
  ].join(' | ')).map(row => `| ${row} |`),
].join('\n');

const text = `# TVLine 片源目录

当前收录 **${catalog.sources.length} 条接口**。${Object.entries(groups).map(([color, items]) => `${labels[color]} ${items.length}`).join(' · ')}

最近一次导入的全量验源时间为 **${date(catalog.lastFullCheckAt)}（北京时间）**。各行显示该接口自己的最后复测时间，结果以验源机器的网络和样本为准。

[片源清单](sources.json) · [JSON 订阅地址](https://raw.githubusercontent.com/MuAiGent/TVLine/main/sources.json)

## 可用池

绿色通过率 ≥ 90%，黄色 ≥ 60% 且低于 90%，红色 > 0% 且低于 60%。搜索优先级为绿 → 黄 → 红。

${table([...groups.green, ...groups.yellow, ...groups.red])}

<details>
<summary>灰色待复测（${groups.gray.length} 条）</summary>

灰色表示样本全未通过或尚未复测。保留记录，复测有样本通过后可恢复进可用池。

${table(groups.gray)}

</details>

## 维护方法

- [在 GitHub 编辑片源清单](https://github.com/MuAiGent/TVLine/edit/main/sources.json)。已有接口沿用原 ID。同名的不同接口可以分别保留。提交到主分支后，GitHub Actions 会自动更新本页。
- 复测后填写样本通过数 \`passed\`、样本总数 \`total\`、状态 \`status\`、时间 \`checkedAt\` 和简短备注 \`note\`。新条目尚未复测时使用 \`gray\`，通过数和总数填 0，时间填 \`null\`。
- 地址使用可公开分享的点播接口。\`lastFullCheckAt\` 只在导入新的全量验源结果时更新。
- 提交前运行 \`node scripts/render-readme.mjs\` 生成这张表。\`node scripts/render-readme.mjs --check\` 可检查清单和 README 是否一致。
`;

if (process.argv.includes('--check')) assert.equal(readFileSync(readme, 'utf8'), text, 'README 需要重新生成');
else writeFileSync(readme, text);

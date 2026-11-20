import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const url = 'https://raw.githubusercontent.com/MuAiGent/TVLine/main/sources.json';
const keyword = '哆啦A梦';
const normalize = (name) => String(name ?? '').normalize('NFKC').replace(/\s/gu, '').toLowerCase();
const run = promisify(execFile);
async function getJson(endpoint) {
  const { stdout } = await run('curl', ['-fsS', '--max-time', '9', '--proto', '=http,https', '--', String(endpoint)],
    { timeout: 12000, maxBuffer: 8 * 1024 * 1024 });
  return JSON.parse(stdout);
}
const catalog = await getJson(url);
assert.equal(catalog.schemaVersion, 1);
const active = catalog.sources.filter(source => ['green', 'yellow', 'red'].includes(source.status));
const sources = active.filter(source => source.format === 'maccms-json').slice(0, 12);
assert(sources.length > 0, '目录没有可验证的 MacCMS JSON 来源');

async function getRows(endpoint) {
  const payload = await getJson(endpoint);
  assert(Array.isArray(payload.list), '片源响应没有结果数组');
  return payload.list;
}

const checks = await Promise.allSettled(sources.map(async (source) => {
  const endpoint = new URL(source.url);
  assert(['http:', 'https:'].includes(endpoint.protocol) && !endpoint.username && !endpoint.password
    && /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z][a-z0-9-]+$/i.test(endpoint.hostname));
  endpoint.search = new URLSearchParams({ ac: 'videolist', wd: keyword, pg: '1' }).toString();
  const list = await getRows(endpoint);
  const match = list.find(item => item.vod_id && normalize(item.vod_name).startsWith(normalize(keyword)));
  if (!match) return '无相关结果';
  endpoint.search = new URLSearchParams({ ac: 'videolist', ids: String(match.vod_id) }).toString();
  const detail = await getRows(endpoint);
  return detail.some(item => String(item.vod_id) === String(match.vod_id) && /https?:\/\//.test(item.vod_play_url ?? ''))
    ? '搜索和详情通过' : '详情无播放地址';
}));

let passed = 0;
for (const [index, check] of checks.entries()) {
  const result = check.status === 'fulfilled' ? check.value : '请求失败或超时';
  if (result === '搜索和详情通过') passed++;
  console.log('%s  %s', sources[index].id, result);
}
console.log('公开目录 %d 条，可用池 %d 条，抽查 %d 条，搜索和详情通过 %d 条', catalog.sources.length, active.length, sources.length, passed);
assert(passed > 0, '本次运行网络没有通过的搜索和详情样本');

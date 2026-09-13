import test from 'node:test';
import assert from 'node:assert/strict';
import {isSandbox, sandboxUrl, persistGet, persistSet, persistRemove} from '../src/sandbox.js';

test('沙盒标记识别', () => {
    assert.equal(isSandbox('?sandbox=1'), true);
    assert.equal(isSandbox('?sandbox=0'), false);
    assert.equal(isSandbox('?other=1'), false);
    assert.equal(isSandbox(''), false);
    assert.equal(isSandbox('?'), false);
});

test('子窗口地址附加标记', () => {
    assert.equal(sandboxUrl('https://example.com/app/'), 'https://example.com/app/?sandbox=1');
    // 已有其它查询参数时保留
    const withQuery = sandboxUrl('https://example.com/app/?a=1');
    assert.equal(new URL(withQuery).searchParams.get('a'), '1');
    assert.equal(isSandbox(new URL(withQuery).search), true);
});

test('重复附加标记是幂等的（孙窗口不叠加参数）', () => {
    const once = sandboxUrl('https://example.com/app/');
    const twice = sandboxUrl(once);
    assert.equal(twice, once);
    assert.equal(new URL(twice).searchParams.getAll('sandbox').length, 1);
});

test('无法解析的地址原样返回', () => {
    assert.equal(sandboxUrl('not a url'), 'not a url');
});

test('无浏览器环境时读写不抛异常', () => {
    assert.doesNotThrow(() => persistSet('k', 'v'));
    assert.doesNotThrow(() => persistRemove('k'));
    assert.equal(persistGet('k'), null);
});

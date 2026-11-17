// Service Worker が最初にキャッシュするファイルの一覧が、実際のファイルと食い違っていないか確かめる。

import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

const ROOT = new URL('../', import.meta.url);
const SW_SOURCE = readFileSync(new URL('sw.js', ROOT), 'utf8');

function appFiles(): string[] {
  const list = /const APP_FILES = \[([\s\S]*?)\];/.exec(SW_SOURCE)?.[1];
  assert.ok(list, 'sw.js に APP_FILES が見つかりません');
  return [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

describe('sw.js の APP_FILES', () => {
  it('ビルドで出力されるすべてのモジュールを含む', () => {
    const modules = readdirSync(new URL('src/', ROOT))
      .filter((name) => name.endsWith('.ts'))
      .map((name) => `dist/${name.replace(/\.ts$/, '.js')}`);
    assert.deepEqual(
      appFiles().filter((f) => f.startsWith('dist/')).sort(),
      modules.sort(),
    );
  });

  it('ビルド出力以外は、リポジトリに実在するファイル', () => {
    for (const file of appFiles().filter((f) => f !== './' && !f.startsWith('dist/'))) {
      assert.ok(existsSync(new URL(file, ROOT)), `${file} がありません`);
    }
  });

  it('manifest のアイコンも実在する', () => {
    const manifest = JSON.parse(readFileSync(new URL('manifest.webmanifest', ROOT), 'utf8')) as {
      icons: { src: string }[];
    };
    for (const { src } of manifest.icons) {
      assert.ok(existsSync(new URL(src, ROOT)), `${src} がありません`);
    }
  });
});

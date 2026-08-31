import { describe, it, expect } from 'vitest';
import { createHash } from 'crypto';
import { mergeManifest } from '../../scripts/siteProjects/seed.mjs';

const sha = (code: string) => createHash('sha256').update(code).digest('hex');

const siteProject = (over: Record<string, unknown> = {}) => ({
  id: 1,
  title: 'Тест',
  author: 'А.',
  difficulty: 'Легко',
  code: 'void setup(){} void loop(){}',
  components: [{ componentId: '1', name: 'Arduino UNO', quantity: 1 }],
  ...over,
});

const snapshot = (projects: any[]) => ({
  fetchedAt: '2026-08-30',
  apiBase: 'https://test.invalid',
  projects,
});

// Итоговое ревью, IMPORTANT I3: seed.mjs перезаписывал манифест целиком —
// повторный запуск (после fetch.mjs обновил слепок) стирал state/vlx/hex/
// verify/unwired уже собранных схем. mergeManifest() — чистая функция без
// файлового I/O (тот же приём, что next.mjs с pickNext()), чтобы это можно
// было проверить без диска и без CLI-обвязки.
describe('слияние манифеста со свежим слепком (seed.mjs)', () => {
  it('первый посев (existing = null) — считает всё с нуля, как раньше', () => {
    const { manifest, added } = mergeManifest(null, snapshot([siteProject()]));
    expect(added).toBe(1);
    expect(manifest.projects).toHaveLength(1);
    expect(manifest.projects[0]).toMatchObject({
      siteId: 1,
      title: 'Тест',
      state: 'pending',
      codeSha256: sha('void setup(){} void loop(){}'),
    });
  });

  it('новый siteId в свежем слепке добавляется, не трогая уже существующие', () => {
    const existing = {
      snapshot: { fetchedAt: 'x', apiBase: 'y', total: 1 },
      projects: [
        {
          siteId: 1,
          title: 'Тест',
          difficulty: 'Легко',
          state: 'verified',
          codeSha256: sha('void setup(){} void loop(){}'),
          vlx: 'circuits/1.vlx',
          hex: 'circuits/1.hex',
          verify: { kind: 'pin-toggle', pins: [13] },
        },
      ],
    };
    const { manifest, added } = mergeManifest(
      existing,
      snapshot([siteProject(), siteProject({ id: 2, title: 'Второй' })]),
    );
    expect(added).toBe(1);
    expect(manifest.projects.map((p: any) => p.siteId).sort()).toEqual([1, 2]);
    const p2 = manifest.projects.find((p: any) => p.siteId === 2);
    expect(p2).toMatchObject({ title: 'Второй', state: 'pending' });
  });

  it('у существующего проекта сохраняется весь прогресс: state/vlx/hex/verify/unwired не трогаются', () => {
    const code = 'void setup(){} void loop(){}';
    const existing = {
      snapshot: { fetchedAt: 'x', apiBase: 'y', total: 1 },
      projects: [
        {
          siteId: 1,
          title: 'Тест',
          difficulty: 'Легко',
          state: 'verified',
          codeSha256: sha(code),
          vlx: 'circuits/1.vlx',
          hex: 'circuits/1.hex',
          unwired: [],
          verify: { kind: 'pin-toggle', pins: [13], lastRun: { at: '2026-08-30', ok: true } },
        },
      ],
    };
    const { manifest, added, staled } = mergeManifest(existing, snapshot([siteProject({ code })]));
    expect(added).toBe(0);
    expect(staled).toBe(0);
    expect(manifest.projects[0]).toEqual(existing.projects[0]);
  });

  it('код на сайте поменялся у verified — переходит в stale (используя checkStale)', () => {
    const existing = {
      snapshot: { fetchedAt: 'x', apiBase: 'y', total: 1 },
      projects: [
        {
          siteId: 1,
          title: 'Тест',
          difficulty: 'Легко',
          state: 'verified',
          codeSha256: sha('старый код'),
          vlx: 'circuits/1.vlx',
          hex: 'circuits/1.hex',
        },
      ],
    };
    const { manifest, staled } = mergeManifest(
      existing,
      snapshot([siteProject({ code: 'новый код' })]),
    );
    expect(staled).toBe(1);
    expect(manifest.projects[0]).toMatchObject({
      state: 'stale',
      codeSha256: sha('старый код'), // не тот, что на сайте сейчас — тот, что реально собрали
      vlx: 'circuits/1.vlx',
    });
  });

  it('код поменялся у ещё не verified (wired) — состояние не трогается', () => {
    const existing = {
      snapshot: { fetchedAt: 'x', apiBase: 'y', total: 1 },
      projects: [
        {
          siteId: 1,
          title: 'Тест',
          difficulty: 'Легко',
          state: 'wired',
          codeSha256: sha('старый код'),
          vlx: 'circuits/1.vlx',
        },
      ],
    };
    const { manifest, staled } = mergeManifest(
      existing,
      snapshot([siteProject({ code: 'новый код' })]),
    );
    expect(staled).toBe(0);
    expect(manifest.projects[0].state).toBe('wired');
  });

  it('siteId из старого манифеста, пропавший из свежего слепка, не удаляется', () => {
    // Пропажа из выгрузки может быть временной (глюк сайта) — молча терять
    // историю дороже, чем оставить лишнюю запись.
    const existing = {
      snapshot: { fetchedAt: 'x', apiBase: 'y', total: 1 },
      projects: [
        { siteId: 99, title: 'Пропавший', difficulty: 'Легко', state: 'verified', codeSha256: 'x' },
      ],
    };
    const { manifest } = mergeManifest(existing, snapshot([siteProject({ id: 1 })]));
    expect(manifest.projects.map((p: any) => p.siteId).sort()).toEqual([1, 99]);
  });

  it('новый проект с блокирующей деталью в BOM заводится blocked (использует blockersFor как раньше)', () => {
    const { manifest } = mergeManifest(
      null,
      snapshot([
        siteProject({ components: [{ componentId: '1', name: 'Arduino Wemos D1', quantity: 1 }] }),
      ]),
    );
    expect(manifest.projects[0]).toMatchObject({
      state: 'blocked',
      blockedBy: ['плата ESP8266 / Wemos D1 не поддерживается'],
    });
  });
});

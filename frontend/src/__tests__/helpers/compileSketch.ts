/**
 * Компиляция скетча бэкендом форка.
 *
 * Тот же путь, которым пользуется приложение: задание ставится через
 * POST /api/compile/start, готовность опрашивается через
 * /api/compile/status/{job_id}. Проба доступности синхронная — иначе её
 * результат не годится для describe.runIf.
 *
 * BACKEND_URL по умолчанию указывает на контейнер сборщика симулятора
 * (it-arduino-sim, порт 3080), а не на API сайта (arduino_api-app-1,
 * порт 8000) — на порту 8000 эндпоинтов /api/compile/* нет.
 *
 * Проба доступности бьёт в /api/compile/boards и считает бэкенд
 * доступным, только если ответ содержит `fqbn`. Проверка `curl .../`
 * недостаточна: любой чужой HTTP-сервис на BACKEND_URL ответит на `/`
 * кодом 200, проба сочтёт бэкенд доступным, тест не пропустится, а
 * реальная компиляция упадёт на 404 — проба обязана убедиться, что
 * отвечает именно сборщик, а не «хоть что-то».
 *
 * Эндпоинт /api/compile/boards НЕ статический: каждый вызов реально
 * запускает `arduino-cli board listall` заново, без кэша и без лока
 * (backend/app/services/arduino_cli.py:759-772, backend/app/api/routes/
 * compile.py:874-876). Под параллельной нагрузкой (несколько прогонов
 * тестов одновременно, как в CI) это заметно медленнее одиночного
 * вызова — таймаут пробы обязан это учитывать (см. PROBE_TIMEOUT_S).
 *
 * Если проба не достучалась, это печатается в stderr одной строкой —
 * адрес, лимит и сколько реально ждали, — чтобы пропуск теста не
 * выглядел неотличимым от прогона с нулём тестов. Переменная окружения
 * SITE_PROJECTS_REQUIRE_BACKEND=1 идёт дальше: превращает недоступность
 * бэкенда из тихого пропуска в падение теста с тем же сообщением —
 * этим переключателем можно закрыть сборке путь считаться зелёной,
 * ничего не проверив.
 *
 * Результат кэшируется во временном каталоге по хешу «исходник + плата»:
 * холодная сборка идёт десятки секунд, и без кэша повторный прогон стоил
 * бы столько же, сколько первый.
 */
import { spawnSync } from 'child_process';
import { createHash } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const BACKEND_URL = process.env.VELXIO_BACKEND_URL ?? 'http://localhost:3080';
const PROBE_URL = `${BACKEND_URL}/api/compile/boards`;

// Подобрано замером, не на глаз (числа — в task-1-report.md): два раунда
// по 8 параллельных `npx vitest run` (та же нагрузка, что и в реальном
// стресс-тесте) с одновременными curl-замерами без обрезки хвоста
// (-m 30) на тот же /api/compile/boards. 16 замеров, диапазон 1.39–2.72 с.
// Старые 2 с достались по наследству от i2c-esp32-real-firmware.test.ts,
// где проба бьёт в статический "/" — там дешёво, здесь эндпоинт каждый
// раз реально запускает arduino-cli. Берём 15 с — это ~5.5× запас к
// худшему замеренному значению.
const PROBE_TIMEOUT_S = 15;

export function backendAvailable(): boolean {
  const startedAt = Date.now();
  const probe = spawnSync('curl', ['-s', '-m', String(PROBE_TIMEOUT_S), '-o', '-', PROBE_URL], {
    encoding: 'utf8',
  });
  const elapsedMs = Date.now() - startedAt;
  const ok = probe.status === 0 && (probe.stdout ?? '').includes('fqbn');

  if (!ok) {
    const reason =
      probe.error != null
        ? `не удалось запустить curl: ${probe.error.message}`
        : probe.status !== 0
          ? `curl завершился кодом ${probe.status} (не уложился в лимит или сеть недоступна)`
          : 'ответ пришёл, но не похож на список плат (нет "fqbn")';
    const message =
      `[siteProjectsCompile] бэкенд недоступен: ${PROBE_URL} не ответил ` +
      `за ${elapsedMs} мс (лимит ${PROBE_TIMEOUT_S * 1000} мс). ${reason}.`;

    if (process.env.SITE_PROJECTS_REQUIRE_BACKEND === '1') {
      // Требование "не пропускать": роняем тест явной ошибкой вместо
      // тихого describe.runIf(false), которое выглядит как "0 relevant
      // tests" и легко проходит незамеченным в зелёной сборке.
      throw new Error(`${message} SITE_PROJECTS_REQUIRE_BACKEND=1 запрещает тихий пропуск.`);
    }
    // Обычный console.error здесь не годится: vitest перехватывает console
    // на воркере и, когда в файле не осталось ни одного реально запущенного
    // теста (весь describe пропущен через runIf(false)), молча роняет
    // буфер — проверено прямой репродукцией на скретч-тесте. process.stderr
    // .write пишет в реальный fd процесса в обход этого перехвата и
    // остаётся видимым в выводе `vitest run` при любом раскладе.
    process.stderr.write(`${message}\n`);
  }

  return ok;
}

export type CompileResult = { ok: true; hex: string } | { ok: false; error: string };

function cachePath(source: string, fqbn: string): string {
  const h = createHash('sha256').update(fqbn).update('\0').update(source).digest('hex');
  return join(tmpdir(), `site-projects-${h.slice(0, 32)}.hex`);
}

export async function compileSketch(source: string, fqbn: string): Promise<CompileResult> {
  const cached = cachePath(source, fqbn);
  if (existsSync(cached)) return { ok: true, hex: readFileSync(cached, 'utf-8') };

  const startRes = await fetch(`${BACKEND_URL}/api/compile/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files: [{ name: 'sketch.ino', content: source }],
      board_fqbn: fqbn,
    }),
    redirect: 'follow',
  });
  if (!startRes.ok) return { ok: false, error: `compile/start ${startRes.status}` };
  const { job_id: jobId } = (await startRes.json()) as { job_id: string };

  const deadline = Date.now() + 300_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2000));
    const sr = await fetch(`${BACKEND_URL}/api/compile/status/${jobId}`);
    if (!sr.ok) continue;
    const s = (await sr.json()) as {
      state: string;
      result?: {
        success?: boolean;
        hex_content?: string;
        binary_content?: string;
        error?: string;
      };
    };
    if (s.state === 'error') return { ok: false, error: s.result?.error ?? 'неизвестная ошибка' };
    if (s.state !== 'done') continue;

    // Бэкенд отдаёт AVR-прошивку как готовый текст Intel HEX в `hex_content`;
    // `binary_content` (base64) занят под .bin/.uf2 других семейств плат и
    // для AVR остаётся null. Проверено напрямую по ответу /compile/status
    // и по CompileResponse в backend/app/api/routes/compile.py.
    const payload = s.result?.hex_content ?? s.result?.binary_content;
    if (!payload) return { ok: false, error: 'бэкенд не вернул прошивку' };
    // Он мог приехать как есть либо в base64 — различаем по первому
    // символу: Intel HEX всегда начинается с ':'.
    const hex = payload.startsWith(':')
      ? payload
      : Buffer.from(payload, 'base64').toString('utf-8');
    if (!hex.startsWith(':')) return { ok: false, error: 'ответ не похож на Intel HEX' };
    writeFileSync(cached, hex, 'utf-8');
    return { ok: true, hex };
  }
  return { ok: false, error: 'сборка не уложилась в 300 с' };
}

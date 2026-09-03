/**
 * Заливка собранных схем в базу сайта.
 *
 * Запуск:
 *   SITE_PROJECTS_DIR=<путь> SITE_ADMIN_TOKEN=<токен> \
 *     node scripts/siteProjects/publish.mjs [--apply] [siteId ...]
 *
 * Без `--apply` ничего не отправляется: печатается, что было бы сделано.
 * Это единственный скрипт набора, который пишет в боевую базу, и первый
 * запуск вслепую здесь стоил бы дороже всех остальных.
 *
 * Куда попадают схемы: таблица `circuits`, поле `project_id` указывает на
 * проект сайта, `is_public` — истина. Страница проекта потом достаёт схему
 * через GET /api/public/projects/{id}/circuit и встраивает симулятор в
 * iframe. Файлы .vlx остаются в репозитории как источник: база — копия,
 * которую этот скрипт умеет пересобрать.
 *
 * Повторный запуск безопасен. Номер созданной схемы записывается в манифест
 * полем `circuitId`; при следующем запуске такой проект обновляется (PUT), а
 * не задваивается. Поэтому манифест после `--apply` нужно закоммитить —
 * иначе связь потеряется и следующий запуск создаст вторые копии.
 *
 * Откуда взять токен: войти на сайт администратором и вызвать
 * `POST /api/users/api-token` — он вернёт значение, которое показывается один
 * раз (в базе лежит только его хэш) и живёт полгода. Это та же серверная
 * сессия, что и у браузера, только предъявляется заголовком Authorization, а
 * не cookie.
 *
 * Токен читается ТОЛЬКО из переменной окружения и никуда не печатается.
 *
 * Права: привязка схемы к чужому проекту разрешена лишь администратору
 * (см. _check_project в arduino_api/app/api/endpoints/circuits.py). Проекты
 * сайта написаны десятками авторов, поэтому токен нужен администраторский —
 * обычный получит 403 на первом же проекте.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { loadManifest, saveManifest } from './manifest.mjs';

const DIR = process.env.SITE_PROJECTS_DIR;
const TOKEN = process.env.SITE_ADMIN_TOKEN;
const API = (process.env.SITE_API_BASE || 'https://api.it-arduino.ru/api').replace(/\/+$/, '');

/** Состояния, схемы которых имеет смысл публиковать. */
const PUBLISHABLE = new Set(['verified', 'needs-attention']);

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const only = args
  .filter((a) => !a.startsWith('--'))
  .map(Number)
  .filter(Boolean);

if (!DIR) {
  console.error('Не задана SITE_PROJECTS_DIR.');
  process.exit(1);
}
if (apply && !TOKEN) {
  // Проверка именно здесь: пробный прогон должен работать без токена, чтобы
  // посмотреть план можно было, ничем не рискуя.
  console.error(
    'Для --apply нужен SITE_ADMIN_TOKEN — токен администратора сайта ' +
      'из POST /api/users/api-token.',
  );
  process.exit(1);
}

async function call(path, method, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${TOKEN}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    // Тело ответа сообщает причину (403 о чужом проекте, 409 о переполнении
    // лимита схем). Без него разбираться пришлось бы по логам сервера.
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : {};
}

const manifest = loadManifest(DIR);
const targets = manifest.projects.filter(
  (p) => PUBLISHABLE.has(p.state) && (only.length === 0 || only.includes(p.siteId)),
);

if (targets.length === 0) {
  console.error('Нечего публиковать: под условие не подошёл ни один проект.');
  process.exit(1);
}

console.log(`${apply ? 'Публикую' : 'Пробный прогон'}: ${targets.length} схем, API ${API}`);

let created = 0;
let updated = 0;
const failed = [];

for (const entry of targets) {
  const vlx = JSON.parse(readFileSync(join(DIR, entry.vlx), 'utf-8'));
  const payload = {
    title: entry.title,
    project_id: entry.siteId,
    is_public: true,
    data: vlx,
  };
  const known = typeof entry.circuitId === 'number' ? entry.circuitId : null;
  const action = known ? `обновление схемы ${known}` : 'создание';

  if (!apply) {
    console.log(
      `  #${entry.siteId} «${entry.title}» — ${action}, ` +
        `${vlx.components.length} деталей, ${vlx.wires.length} проводов`,
    );
    continue;
  }

  try {
    if (known) {
      // PUT принимает те же поля; project_id и is_public повторяются
      // намеренно — схему могли отвязать вручную, и молчаливое сохранение
      // такого состояния означало бы, что вкладка исчезла и не вернулась.
      await call(`/circuits/${known}`, 'PUT', payload);
      updated += 1;
      console.log(`  #${entry.siteId} обновлена (схема ${known})`);
    } else {
      const circuit = await call('/circuits', 'POST', payload);
      entry.circuitId = circuit.id;
      created += 1;
      console.log(`  #${entry.siteId} создана (схема ${circuit.id})`);
      // Манифест сохраняется после КАЖДОГО создания, а не в конце: обрыв на
      // середине иначе оставил бы схемы в базе без номеров в манифесте, и
      // следующий запуск создал бы их заново.
      saveManifest(DIR, manifest);
    }
  } catch (err) {
    failed.push(`#${entry.siteId}: ${err.message}`);
    console.error(`  #${entry.siteId} ОШИБКА: ${err.message}`);
  }
}

if (apply) {
  saveManifest(DIR, manifest);
  console.log(`\nСоздано ${created}, обновлено ${updated}, с ошибкой ${failed.length}.`);
  if (failed.length) {
    console.error('\nНе прошли:');
    for (const f of failed) console.error('  ' + f);
    process.exit(1);
  }
  console.log('Манифест обновлён — закоммитьте его, иначе связь со схемами потеряется.');
} else {
  console.log('\nЭто был пробный прогон. Добавьте --apply, чтобы отправить.');
}

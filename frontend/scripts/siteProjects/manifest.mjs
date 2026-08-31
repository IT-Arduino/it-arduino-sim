/**
 * Манифест — единственное место, где живёт состояние работы.
 *
 * Переходы ограничены намеренно. Разрешить произвольную смену состояния
 * значит допустить `verified` у схемы, которую никто не собирал: ошибка
 * тихая, а последствие — проект, считающийся готовым и таковым не
 * являющийся.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';

export const STATES = [
  'pending',
  'scaffolded',
  'wired',
  'verified',
  'needs-attention',
  'blocked',
  'stale',
];

const ALLOWED = {
  pending: ['scaffolded', 'blocked'],
  scaffolded: ['wired', 'blocked'],
  wired: ['verified', 'needs-attention'],
  verified: ['stale'],
  'needs-attention': ['wired', 'blocked'],
  stale: ['wired'],
  blocked: [],
};

export function canTransition(from, to) {
  return (ALLOWED[from] ?? []).includes(to);
}

export function advance(entry, to) {
  if (!canTransition(entry.state, to)) {
    throw new Error(`недопустимый переход: ${entry.state} → ${to}`);
  }
  return { ...entry, state: to };
}

/**
 * Сверка записи манифеста со свежим кодом сайта (итоговое ревью, IMPORTANT
 * I2): «codeSha256 пишется и никогда не читается». Спека обещала —
 * «несовпадение хеша при следующей выгрузке переводит проект в stale» — но
 * ничего в кодовой базе не сравнивало старый и новый хеш, поэтому stale
 * оставалось недостижимым, хотя есть в STATES и в ALLOWED (stale: ['wired']).
 *
 * Срабатывает только для entry.state === 'verified': это единственное
 * состояние, из которого canTransition разрешает переход в stale — так
 * задумано в ALLOWED (см. докстринг модуля про «переходы ограничены
 * намеренно»). Для pending/blocked/scaffolded/wired/needs-attention
 * расхождение хеша ничего не меняет: там ещё нет (pending, blocked) либо
 * ещё не подтверждённой поведением (scaffolded/wired) схемы, которая могла
 * бы «протухнуть» относительно кода, — переход stale для них не определён,
 * и решать вопрос молчаливым обновлением codeSha256 в обход этого — то же
 * самое разъезжание, от которого спасает само поле.
 *
 * codeSha256 у переведённой в stale записи НЕ обновляется: он остаётся
 * тем, что реально было собрано и проверено (историческая точка сверки),
 * а не тем, что сейчас на сайте. Обновление — задача будущего цикла
 * wire→verify после того, как схему действительно пересоберут.
 */
export function checkStale(entry, freshCodeSha256) {
  if (entry.codeSha256 === freshCodeSha256) return entry;
  if (entry.state !== 'verified' || !canTransition(entry.state, 'stale')) return entry;
  return advance(entry, 'stale');
}

export function manifestPath(dir) {
  return join(dir, 'manifest.json');
}

export function loadManifest(dir) {
  return JSON.parse(readFileSync(manifestPath(dir), 'utf-8'));
}

export function saveManifest(dir, manifest) {
  const path = manifestPath(dir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(manifest, null, 1) + '\n', 'utf-8');
}

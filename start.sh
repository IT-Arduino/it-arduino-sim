#!/bin/sh
#
# Обновление и перезапуск симулятора: подтянуть изменения, пересобрать образы
# и поднять службы заново.
#
# Заменяет собой длинную строку, которую иначе приходится набирать каждый раз:
#
#   cd ~/it-arduino-sim && git pull && docker compose \
#     -f docker-compose.avr.yml -f docker-compose.avr.override.yml \
#     up -d --build --force-recreate --renew-anon-volumes
#
# Запуск: ./start.sh   (из PowerShell: bash start.sh)

set -e

# Каталог берётся от самого скрипта, а не зашивается путём `~/it-arduino-sim`:
# так он работает и на сервере, и на любой другой машине, куда репозиторий
# склонировали в другое место.
cd "$(dirname "$0")"

# ── docker compose или docker-compose ────────────────────────────────────
# Новый docker — подкоманда, старый — отдельная программа. Проверяем, а не
# гадаем: на разных машинах живут обе.
if docker compose version >/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE="docker-compose"
else
  echo "Не нашёл docker compose. Установите Docker и попробуйте снова." >&2
  exit 1
fi

# ── Обновление ───────────────────────────────────────────────────────────
# Сначала обновляемся, потом собираем. Если pull не прошёл — например, из-за
# правок, сделанных прямо на сервере, — скрипт останавливается (set -e), и это
# правильно: молча пересобрать старый код значит выкатить не то, что
# ожидалось, и не узнать об этом.
echo "Подтягиваю изменения…"
git pull

# ── Набор compose-файлов ─────────────────────────────────────────────────
# Основной файл лежит в репозитории. Файла надстройки в репозитории нет — он
# живёт только на той машине, где настройки свои (порты, тома, переменные).
# Поэтому подставляем его, только если он есть: иначе скрипт работал бы
# исключительно на сервере и падал бы везде ещё.
COMPOSE_FILES="-f docker-compose.avr.yml"
if [ -f docker-compose.avr.override.yml ]; then
  COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.avr.override.yml"
  echo "Использую надстройку docker-compose.avr.override.yml."
else
  echo "Надстройки docker-compose.avr.override.yml нет — поднимаю без неё."
fi

# ── Сборка и подъём ──────────────────────────────────────────────────────
# --force-recreate пересоздаёт контейнеры, даже когда конфигурация не
# менялась: иначе docker вправе оставить прежний контейнер на новом образе.
# --renew-anon-volumes выбрасывает БЕЗЫМЯННЫЕ тома — те, что docker завёл сам.
# Именованных томов, заведённых осознанно, это не касается.
echo "Собираю образы и поднимаю службы…"
# shellcheck disable=SC2086  # COMPOSE_FILES — несколько отдельных аргументов
$COMPOSE $COMPOSE_FILES up -d --build --force-recreate --renew-anon-volumes

echo
echo "Готово."
echo "  Состояние $COMPOSE $COMPOSE_FILES ps"
echo "  Журнал    $COMPOSE $COMPOSE_FILES logs -f"
echo "  Остановка $COMPOSE $COMPOSE_FILES down"

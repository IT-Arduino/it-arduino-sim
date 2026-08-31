import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { loadManifest } from '../../scripts/siteProjects/manifest.mjs';
import { runPinToggle } from './helpers/runSketch';
import { runLcdText } from './helpers/runLcd';
import { runLcdTextI2c } from './helpers/runLcdI2c';
import { runAnalog } from './helpers/runAnalog';
import { runDigitalInput } from './helpers/runDigitalInput';
import { runSerial } from './helpers/runSerial';

const DIR = process.env.SITE_PROJECTS_DIR;
const dirProvided = Boolean(DIR);
const dirExists = dirProvided && existsSync(DIR!);
const manifestFile = dirProvided ? join(DIR!, 'manifest.json') : '';
const manifestExists = dirExists && existsSync(manifestFile);

// Плата → тип платы симулятора. В манифесте сейчас встречается только
// arduino-uno; arduino-mega обработан заранее для будущих проектов —
// остальные значения тоже приводятся к 'uno', как и в исходном черновике.
const boardKind = (board: string): 'uno' | 'mega' => (board === 'arduino-mega' ? 'mega' : 'uno');

// Имя вывода на стороне платы в .vlx: аналоговые каналы записаны как
// "A0".."A5" (см. wiring.mjs, правило потенциометра — 'pot1:SIG →
// board1:A0'), а не как числовой вывод 14-19, которым оперирует
// PinManager/runAnalog. Цифровые выводы записаны как есть.
const wireSideName = (pin: number): string =>
  pin >= 14 && pin <= 19 ? `A${pin - 14}` : String(pin);

// Три разных состояния, не два: «переменная не задана» (пропуск — данных
// никто не обещал) — это не то же самое, что «переменная задана, но по
// этому пути пусто» (падение: опечатка в пути иначе даёт тихий зелёный
// прогон при нуле проверенного — тот же отказ, что чинили в Task 1 для
// пробы бэкенда). describe(...) здесь без .runIf/.skip: проверено
// эмпирически, что describe.runIf(false) всё равно вызывает функцию
// фабрики при сборке дерева тестов — runIf/skip лишь помечают уже
// зарегистрированные it() пропущенными, а не отменяют сам вызов фабрики.
// Все три состояния разведены явно через it.skip/it с ранним return, так
// что сама фабрика больше не полагается на runIf.
describe('схемы проектов сайта', () => {
  if (!dirProvided) {
    it.skip('пропущено: SITE_PROJECTS_DIR не задана', () => {});
    return;
  }

  if (!manifestExists) {
    // Сообщение называет ровно тот путь, что взят из переменной, и чего
    // именно по нему не нашлось — опечатку в SITE_PROJECTS_DIR должно быть
    // видно по тексту падения, а не только по факту падения.
    it('SITE_PROJECTS_DIR задана, но данные не найдены', () => {
      if (!dirExists) {
        throw new Error(`SITE_PROJECTS_DIR="${DIR}": каталог не существует`);
      }
      throw new Error(`SITE_PROJECTS_DIR="${DIR}": файл ${manifestFile} не найден`);
    });
    return;
  }

  const manifest = loadManifest(DIR!);
  const verified = manifest.projects.filter((p: any) => p.state === 'verified');

  // needs-attention: собрана и поведенчески проверена ровно как verified, но
  // несёт хотя бы одну замену детали на электрически эквивалентную
  // (substitutions[]) — владелец разрешал править код, не деталь, поэтому
  // финальное состояние ждёт его решения, а не молчаливо становится verified
  // (партия 9, #82/#57/#56/#40). Барьер «поведенческая проверка
  // зарегистрирована» ниже обязан замечать и такие схемы — иначе для них
  // «зелено» ничего не доказывает, ровно тот разрыв, который барьер и был
  // придуман закрывать (CRITICAL C1 итогового ревью). verified НЕ
  // переопределяется этим набором: тест «verified не уживается с непустым
  // unwired» ниже проверяет более строгое правило, которое к needs-attention
  // не относится — там unwired допустим (например, водяной насос #56 не
  // находит электрического эквивалента в каталоге вовсе).
  const behaviorChecked = manifest.projects.filter(
    (p: any) => p.state === 'verified' || p.state === 'needs-attention',
  );

  // Барьер против «зелено при нуле проверенного» (итоговое ревью, CRITICAL
  // C1). Три независимых способа получить зелёный набор без единой реальной
  // проверки поведения были воспроизведены на копии манифеста: (а)
  // verify.kind, которого раннер не знает ('analog') — ни один из циклов
  // ниже под него не подходит, it() не создаётся вовсе; (б) verify.pins: []
  // у pin-toggle — it() создаётся, но внутренний for по pins пуст, ни
  // одного expect; (в) у lcd-text не было проверки связи с .vlx — можно
  // было вынуть все провода, поведенческий тест гоняет только .hex и не
  // замечает.
  //
  // Вместо трёх точечных заплаток — один барьер: каждый цикл ниже, регистрируя
  // it() для конкретного siteId, отмечает этот siteId в checkedSiteIds.
  // Отметка происходит здесь, в теле describe, синхронно при СБОРКЕ дерева
  // тестов — до того, как отработает хоть один it() — поэтому финальный
  // тест ниже не зависит от порядка выполнения: множество checkedSiteIds
  // уже полностью готово к моменту его регистрации. siteId, для которого
  // при сборке не был создан ни один поведенческий it() (потому что ни один
  // цикл не взял его kind — случай (а), и любой будущий kind, который мы
  // сегодня не придумали), в checkedSiteIds не попадёт и будет назван
  // поимённо. Случай (б) барьер не ловит (it() всё-таки регистрируется под
  // kind: 'pin-toggle') — для него ниже отдельный explicit-assert на
  // непустоту pins. Случай (в) закрыт отдельной проверкой связи .vlx для
  // lcd-text, зеркальной уже существовавшей для pin-toggle.
  const checkedSiteIds = new Set<number>();

  it('у каждой проверенной схемы есть файлы и описание проверки', () => {
    for (const p of behaviorChecked) {
      expect(p.vlx, `#${p.siteId}: нет .vlx`).toBeTruthy();
      expect(p.verify, `#${p.siteId}: нет verify`).toBeTruthy();
      expect(existsSync(join(DIR!, p.vlx)), `#${p.siteId}: файл ${p.vlx} отсутствует`).toBe(true);
    }
  });

  it('verified не уживается с непустым unwired', () => {
    // Итоговое ревью, IMPORTANT I9: #63 был "state": "verified" рядом с
    // "unwired": ["c3"] — терминальное состояние обещает «схема собрана»,
    // а манифест тут же пишет, что не вся. Выбранное разрешение
    // противоречия (см. отчёт): "verified" требует пустого unwired, а не
    // отдельного поля-объяснения — несоединённая деталь либо действительно
    // подключается (как c3 у #63 — токоограничивающий резистор подсветки,
    // который generateWiring теперь ставит), либо схема не имеет права
    // называться verified.
    const withLeftovers = verified.filter((p: any) => (p.unwired?.length ?? 0) > 0);
    expect(
      withLeftovers.map((p: any) => `#${p.siteId}: unwired=${JSON.stringify(p.unwired)}`),
      'verified-схемы с несоединёнными деталями',
    ).toEqual([]);
  });

  for (const p of behaviorChecked.filter((x: any) => x.verify?.kind === 'pin-toggle')) {
    checkedSiteIds.add(p.siteId);

    // Число тактов — из manifest.verify.cycles, не общий хардкод: у разных
    // схем разная логика в loop() и разный такт до нужного числа переключений
    // (см. обоснования порогов в runSketch.ts/runLcd.ts, где они подбирались
    // измерением для конкретных прошивок #28 и #63).
    it(`#${p.siteId} «${p.title}»: выводы переключаются`, () => {
      // pins: [] регистрирует this it(), но внутренний for ниже пустой —
      // ноль expect молча проходит. Явно требуем непустой список, а не
      // полагаемся на барьер: барьер видит "kind известен, it() создан" и
      // этого случая не ловит (находка (б) итогового ревью).
      expect(
        Array.isArray(p.verify.pins) && p.verify.pins.length > 0,
        `#${p.siteId}: verify.pins пуст — проверять нечего`,
      ).toBe(true);
      // minChanges: необязательное поле, по умолчанию 2 (как было для всех
      // девяти pin-toggle схем до партии 9 — их порог не меняется). Введено
      // для #82: pulseIn(echoPin, HIGH) в голом прогоне без внешнего эха
      // всегда таймаутит (в каталоге нет входа, которым тест мог бы задать
      // расстояние на HC-SR04 — проверено чтением SensorParts.ts, ECHO
      // получает импульс только через attachEvents() интерактивной сборки,
      // а не через AVRSimulator/PinManager напрямую), измеренное расстояние
      // получается нулевым, а порог близости в прошивке проходит уже на
      // первой итерации — LASER уходит в HIGH ОДИН раз и остаётся там:
      // измерено напрямую (runPinToggle,
      // 20/30/50/80 млн тактов) — вывод 10 стабильно даёт ровно 1 переход
      // на всём диапазоне, ни разу не возвращаясь в LOW (повторный
      // digitalWrite тем же значением не создаёт событие onPinChange).
      // minChanges всё равно требует ХОТЯ БЫ одного перехода от сбрасываемого
      // по умолчанию LOW — это не вырожденная проверка: пин, ни к чему не
      // подключённый или не задетый веткой distance<20, дал бы 0 и упал.
      const minChanges = typeof p.verify.minChanges === 'number' ? p.verify.minChanges : 2;
      expect(
        minChanges,
        `#${p.siteId}: verify.minChanges должен быть не меньше 1`,
      ).toBeGreaterThanOrEqual(1);
      const hex = readFileSync(join(DIR!, p.hex), 'utf-8');
      const changes = runPinToggle(hex, boardKind(p.board), p.verify.pins, p.verify.cycles);
      for (const pin of p.verify.pins) {
        expect(
          changes.get(pin)?.length ?? 0,
          `вывод ${pin} не переключался`,
        ).toBeGreaterThanOrEqual(minChanges);
      }
    });

    // runPinToggle гоняет ядро AVR прямо по .hex и никогда не заглядывает в
    // .vlx — «вывод переключается» проверяет только прошивку. Схему можно
    // разобрать полностью (убрать все провода) и тест выше этого не
    // заметит: state: verified обещает («схема собрана И поведение
    // проверено»), а без этой проверки подтверждена только вторая половина.
    // Здесь закрываем первую: каждый вывод из verify.pins должен быть
    // концом (start или end) хотя бы одного провода на компоненте платы.
    it(`#${p.siteId} «${p.title}»: выводы подключены проводом в .vlx`, () => {
      expect(
        Array.isArray(p.verify.pins) && p.verify.pins.length > 0,
        `#${p.siteId}: verify.pins пуст — проверять нечего`,
      ).toBe(true);
      const vlx = JSON.parse(readFileSync(join(DIR!, p.vlx), 'utf-8'));
      const boardIds = new Set((vlx.boards ?? []).map((b: any) => b.id));
      const wiredPins = new Set<string>();
      for (const w of vlx.wires ?? []) {
        for (const end of [w.start, w.end]) {
          if (end && boardIds.has(end.componentId)) wiredPins.add(String(end.pinName));
        }
      }
      for (const pin of p.verify.pins) {
        expect(
          wiredPins.has(String(pin)),
          `#${p.siteId}: вывод ${pin} не встречается концом провода в .vlx`,
        ).toBe(true);
      }
    });
  }

  for (const p of behaviorChecked.filter((x: any) => x.verify?.kind === 'lcd-text')) {
    checkedSiteIds.add(p.siteId);

    // verify.pins здесь — объект {rs, e, d4, d5, d6, d7}, не массив: форма
    // зависит от verify.kind, а не наоборот (см. документацию в спеке) —
    // поэтому ветки pin-toggle и lcd-text различают именно kind.
    it(`#${p.siteId} «${p.title}»: на дисплей пришёл текст`, () => {
      const hex = readFileSync(join(DIR!, p.hex), 'utf-8');
      const lines = runLcdText(hex, boardKind(p.board), p.verify.pins, p.verify.cycles);
      expect(lines.join(' ').trim().length, 'дисплей остался пустым').toBeGreaterThan(0);
    });

    // Зеркало проверки связи .vlx у pin-toggle выше (находка (в) итогового
    // ревью): runLcdText тоже гоняет только .hex и не смотрит в .vlx. У
    // #63 «Азбука Морзе» можно было вынуть все 13 проводов из 63.vlx —
    // поведенческий тест этого не заметит, потому что HD44780Decoder читает
    // поток байт из прошивки, а не схему. Здесь каждый из шести именованных
    // выводов LCD должен встречаться концом провода на плате.
    it(`#${p.siteId} «${p.title}»: выводы LCD подключены проводом в .vlx`, () => {
      const vlx = JSON.parse(readFileSync(join(DIR!, p.vlx), 'utf-8'));
      const boardIds = new Set((vlx.boards ?? []).map((b: any) => b.id));
      const wiredPins = new Set<string>();
      for (const w of vlx.wires ?? []) {
        for (const end of [w.start, w.end]) {
          if (end && boardIds.has(end.componentId)) wiredPins.add(String(end.pinName));
        }
      }
      const pins = p.verify.pins as Record<'rs' | 'e' | 'd4' | 'd5' | 'd6' | 'd7', unknown>;
      for (const key of ['rs', 'e', 'd4', 'd5', 'd6', 'd7'] as const) {
        const pin = pins?.[key];
        expect(pin, `#${p.siteId}: verify.pins.${key} не задан`).toBeTruthy();
        expect(
          wiredPins.has(String(pin)),
          `#${p.siteId}: вывод ${key}=${pin} не встречается концом провода в .vlx`,
        ).toBe(true);
      }
    });
  }

  for (const p of behaviorChecked.filter((x: any) => x.verify?.kind === 'lcd-text-i2c')) {
    checkedSiteIds.add(p.siteId);

    // LiquidCrystal_I2C гонит HD44780 через аппаратный модуль TWI платы и
    // переходник PCF8574 на шине I2C, а не через шесть GPIO-выводов, как
    // lcd-text (см. докстринг runLcdI2c.ts). verify.address — адрес PCF8574
    // на шине, десятичным числом (0x27 — самый частый адрес готовых
    // I2C-переходников — это десятичное 39).
    it(`#${p.siteId} «${p.title}»: на дисплей пришёл текст по I2C`, { timeout: 60_000 }, () => {
      expect(
        typeof p.verify.address === 'number',
        `#${p.siteId}: verify.address не задан числом`,
      ).toBe(true);
      const hex = readFileSync(join(DIR!, p.hex), 'utf-8');
      const lines = runLcdTextI2c(hex, boardKind(p.board), p.verify.address, p.verify.cycles);
      expect(lines.join(' ').trim().length, 'дисплей остался пустым').toBeGreaterThan(0);
    });

    // Зеркало проверки связи .vlx у lcd-text (находка (в) итогового ревью,
    // см. выше): runLcdTextI2c тоже гоняет только .hex и не смотрит в .vlx.
    // У I2C нет отдельных выводов RS/E/D4-D7 — есть только аппаратные
    // SDA/SCL платы, которые скетч не выбирает (на Uno всегда A4/A5).
    it(`#${p.siteId} «${p.title}»: выводы SDA/SCL подключены проводом в .vlx`, () => {
      const vlx = JSON.parse(readFileSync(join(DIR!, p.vlx), 'utf-8'));
      const boardIds = new Set((vlx.boards ?? []).map((b: any) => b.id));
      const wiredPins = new Set<string>();
      for (const w of vlx.wires ?? []) {
        for (const end of [w.start, w.end]) {
          if (end && boardIds.has(end.componentId)) wiredPins.add(String(end.pinName));
        }
      }
      // 18/19 = A4/A5 в нумерации PinManager (14 + номер канала) — те же
      // фиксированные аппаратные выводы TWI Uno, что уже используют
      // существующие примеры OLED/RTC в src/data/examples.ts.
      for (const pin of [18, 19]) {
        expect(
          wiredPins.has(wireSideName(pin)),
          `#${p.siteId}: вывод ${wireSideName(pin)} не встречается концом провода в .vlx`,
        ).toBe(true);
      }
    });
  }

  for (const p of behaviorChecked.filter((x: any) => x.verify?.kind === 'analog')) {
    checkedSiteIds.add(p.siteId);

    // Смысл проверки: схема обещает «крутим ручку — меняется отклик».
    // SPICE здесь не нужен (спека предполагала «напряжение узла после
    // решения SPICE» — PinManager.setAnalogVoltage подаёт напряжение
    // на ADC напрямую, минуя электрическую цепь целиком, см. докстринг
    // runAnalog.ts). Прогоняем прошивку дважды с разным напряжением на
    // verify.input.pin (плюс любые verify.fixed — второй аналоговый вход,
    // который должен остаться постоянным, как у #74) и требуем разный
    // отклик на verify.output.pin. Одинаковый отклик у разных напряжений —
    // ровно тот разрыв входа с выходом, который эта проверка обязана ловить
    // (например, #36/#77 прежде проверялись pin-toggle, который на ШИМ без
    // внешнего напряжения на входе даёт 0 переключений и молча не проверяет
    // ничего связанного с потенциометром).
    // Явный таймаут (не дефолтные 30с из vitest.config.ts): здесь прогоняется
    // ДВА полных прогона (low + high) на попытку, а measured-бюджет циклов
    // на этой машине идёт ~6-7 млн тактов/с при пошаговом step() (замерено
    // на уже существующем #30: 260 000 000 тактов ~42с, за пределами
    // дефолтного таймаута) — запас на медленную машину CI не помешает.
    it(`#${p.siteId} «${p.title}»: выход реагирует на аналоговый вход`, { timeout: 60_000 }, () => {
      const v = p.verify;
      expect(v.input?.pin, `#${p.siteId}: verify.input.pin не задан`).toBeTruthy();
      expect(
        typeof v.input?.low === 'number' && typeof v.input?.high === 'number',
        `#${p.siteId}: verify.input.low/high не заданы числом`,
      ).toBe(true);
      expect(v.output?.pin, `#${p.siteId}: verify.output.pin не задан`).toBeTruthy();
      expect(
        ['pwm', 'digital-level', 'digital-count'].includes(v.output?.signal),
        `#${p.siteId}: verify.output.signal=${v.output?.signal} — не pwm/digital-level/digital-count`,
      ).toBe(true);

      const hex = readFileSync(join(DIR!, p.hex), 'utf-8');
      const fixedInputs = (v.fixed ?? []).map((f: any) => ({ pin: f.pin, voltage: f.voltage }));
      const runAt = (voltage: number) =>
        runAnalog(
          hex,
          boardKind(p.board),
          [{ pin: v.input.pin, voltage }, ...fixedInputs],
          v.output.pin,
          v.cycles,
        );
      const low = runAt(v.input.low);
      const high = runAt(v.input.high);

      if (v.output.signal === 'pwm') {
        expect(
          low.pwm,
          `#${p.siteId}: скважность ШИМ на выводе ${v.output.pin} одинакова (${low.pwm}) при ${v.input.low}В и ${v.input.high}В на входе`,
        ).not.toBe(high.pwm);
      } else if (v.output.signal === 'digital-count') {
        expect(
          low.toggleCount,
          `#${p.siteId}: число переключений вывода ${v.output.pin} одинаково (${low.toggleCount}) при ${v.input.low}В и ${v.input.high}В на входе`,
        ).not.toBe(high.toggleCount);
      } else {
        expect(
          low.level,
          `#${p.siteId}: уровень вывода ${v.output.pin} одинаков (${low.level}) при ${v.input.low}В и ${v.input.high}В на входе`,
        ).not.toBe(high.level);
      }
    });

    // Зеркало проверки связи .vlx у pin-toggle/lcd-text выше: runAnalog
    // гоняет только .hex и не смотрит в .vlx — схему можно разобрать
    // полностью, поведенческий тест этого не заметит. Выводы входа
    // (verify.input.pin, verify.fixed[].pin — переведённые в форму "A<n>",
    // которой .vlx называет аналоговые каналы, см. wireSideName выше) и
    // выхода (verify.output.pin, как есть) обязаны встречаться концом
    // провода на плате.
    it(`#${p.siteId} «${p.title}»: аналоговые выводы подключены проводом в .vlx`, () => {
      const v = p.verify;
      const vlx = JSON.parse(readFileSync(join(DIR!, p.vlx), 'utf-8'));
      const boardIds = new Set((vlx.boards ?? []).map((b: any) => b.id));
      const wiredPins = new Set<string>();
      for (const w of vlx.wires ?? []) {
        for (const end of [w.start, w.end]) {
          if (end && boardIds.has(end.componentId)) wiredPins.add(String(end.pinName));
        }
      }
      const pinsToCheck = [v.output.pin, v.input.pin, ...(v.fixed ?? []).map((f: any) => f.pin)];
      for (const pin of pinsToCheck) {
        expect(
          wiredPins.has(wireSideName(pin)),
          `#${p.siteId}: вывод ${pin} (${wireSideName(pin)}) не встречается концом провода в .vlx`,
        ).toBe(true);
      }
    });
  }

  for (const p of behaviorChecked.filter((x: any) => x.verify?.kind === 'digital-input')) {
    checkedSiteIds.add(p.siteId);

    // Смысл проверки: часть схем управляет выходом ТОЛЬКО через digitalRead()
    // обычного цифрового вывода без внутренней подтяжки (кнопка на голом
    // INPUT, либо вовсе без pinMode — вывод остаётся в состоянии по
    // умолчанию после сброса). Без решения электрической схемы такой вывод
    // в голом прогоне (см. pin-toggle выше) всегда читается фиксированным
    // низким уровнем — ни один toggle не происходит, сколько тактов ни
    // давай (докстринг runDigitalInput.ts). Как и analog, задаём внешний
    // уровень напрямую (AVRSimulator.setPinState — тот же публичный метод,
    // которым в приложении управляет деталь-кнопка) и требуем разный
    // отклик у разных уровней.
    it(`#${p.siteId} «${p.title}»: выход реагирует на цифровой вход`, { timeout: 60_000 }, () => {
      const v = p.verify;
      expect(v.input?.pin, `#${p.siteId}: verify.input.pin не задан`).toBeTruthy();
      expect(
        typeof v.input?.low === 'boolean' && typeof v.input?.high === 'boolean',
        `#${p.siteId}: verify.input.low/high не заданы булевым значением`,
      ).toBe(true);
      expect(v.output?.pin, `#${p.siteId}: verify.output.pin не задан`).toBeTruthy();
      expect(
        ['pwm', 'digital-level', 'digital-count'].includes(v.output?.signal),
        `#${p.siteId}: verify.output.signal=${v.output?.signal} — не pwm/digital-level/digital-count`,
      ).toBe(true);

      const hex = readFileSync(join(DIR!, p.hex), 'utf-8');
      const fixedInputs = (v.fixed ?? []).map((f: any) => ({ pin: f.pin, state: f.state }));
      // delayCycles (необязательно, партия 9, #40): держит вывод на его
      // прежнем уровне заданное число тактов перед подачей state — нужно
      // для edge/interrupt-driven входов (attachInterrupt), которым важен
      // настоящий переход, а не уровень, заданный с самого начала. См.
      // докстринг runDigitalInput.ts. Отсутствует у verify.input —
      // undefined проходит как «нет задержки», прежнее поведение для
      // #34/#75/#56 не меняется.
      const runAt = (state: boolean) =>
        runDigitalInput(
          hex,
          boardKind(p.board),
          [{ pin: v.input.pin, state, delayCycles: v.input.delayCycles }, ...fixedInputs],
          v.output.pin,
          v.cycles,
        );
      const low = runAt(v.input.low);
      const high = runAt(v.input.high);

      if (v.output.signal === 'pwm') {
        expect(
          low.pwm,
          `#${p.siteId}: скважность ШИМ на выводе ${v.output.pin} одинакова (${low.pwm}) при входе ${v.input.low} и ${v.input.high}`,
        ).not.toBe(high.pwm);
      } else if (v.output.signal === 'digital-count') {
        expect(
          low.toggleCount,
          `#${p.siteId}: число переключений вывода ${v.output.pin} одинаково (${low.toggleCount}) при входе ${v.input.low} и ${v.input.high}`,
        ).not.toBe(high.toggleCount);
      } else {
        expect(
          low.level,
          `#${p.siteId}: уровень вывода ${v.output.pin} одинаков (${low.level}) при входе ${v.input.low} и ${v.input.high}`,
        ).not.toBe(high.level);
      }
    });

    // Зеркало проверки связи .vlx у analog выше: runDigitalInput тоже гоняет
    // только .hex и не смотрит в .vlx. Выводы входа (verify.input.pin,
    // verify.fixed[].pin) и выхода (verify.output.pin) — переведённые в
    // форму "A<n>" там, где это аналоговый номер 14-19, той же wireSideName,
    // что и у analog, — обязаны встречаться концом провода на плате.
    it(`#${p.siteId} «${p.title}»: цифровые выводы подключены проводом в .vlx`, () => {
      const v = p.verify;
      const vlx = JSON.parse(readFileSync(join(DIR!, p.vlx), 'utf-8'));
      const boardIds = new Set((vlx.boards ?? []).map((b: any) => b.id));
      const wiredPins = new Set<string>();
      for (const w of vlx.wires ?? []) {
        for (const end of [w.start, w.end]) {
          if (end && boardIds.has(end.componentId)) wiredPins.add(String(end.pinName));
        }
      }
      const pinsToCheck = [v.output.pin, v.input.pin, ...(v.fixed ?? []).map((f: any) => f.pin)];
      for (const pin of pinsToCheck) {
        expect(
          wiredPins.has(wireSideName(pin)),
          `#${p.siteId}: вывод ${pin} (${wireSideName(pin)}) не встречается концом провода в .vlx`,
        ).toBe(true);
      }
    });
  }

  for (const p of behaviorChecked.filter((x: any) => x.verify?.kind === 'serial')) {
    checkedSiteIds.add(p.siteId);

    // Смысл проверки: часть проектов не делает НИ ОДНОГО digitalWrite()/
    // analogWrite()/tone() — единственный наблюдаемый эффект прошивки уходит
    // в Serial.print/println (#66 «Датчик пульса»: только analogRead() +
    // Serial.println()). Ни один из четырёх прежних видов не имеет
    // MCU-управляемого вывода, за которым можно наблюдать — отсюда пятый вид.
    // runSerial прогоняет прошивку один раз, меняя напряжение на
    // verify.input.pin с low на high на середине прогона (см. докстринг
    // runSerial.ts), и собирает весь текст, ушедший в Serial. Требуем: порт
    // не молчал, и напечатанные строки не все одинаковы — тот же барьер
    // «вход должен влиять на выход», что уже стоит у analog/digital-input,
    // только через печать, а не через уровень вывода.
    it(
      `#${p.siteId} «${p.title}»: последовательный порт печатает меняющиеся значения`,
      { timeout: 60_000 },
      () => {
        const v = p.verify;
        expect(v.input?.pin, `#${p.siteId}: verify.input.pin не задан`).toBeTruthy();
        expect(
          typeof v.input?.low === 'number' && typeof v.input?.high === 'number',
          `#${p.siteId}: verify.input.low/high не заданы числом`,
        ).toBe(true);

        const hex = readFileSync(join(DIR!, p.hex), 'utf-8');
        const { lines } = runSerial(hex, boardKind(p.board), v.input, v.cycles);

        expect(lines.length, `#${p.siteId}: последовательный порт молчал`).toBeGreaterThan(0);
        const distinct = new Set(lines);
        expect(
          distinct.size,
          `#${p.siteId}: все строки одинаковы (${JSON.stringify([...distinct])}) — смена входа с ${v.input.low}В на ${v.input.high}В не отразилась на выводе`,
        ).toBeGreaterThan(1);
      },
    );

    // Зеркало проверки связи .vlx у analog/digital-input выше: runSerial тоже
    // гоняет только .hex и не смотрит в .vlx. У serial нет verify.output.pin
    // (нет вывода, которым сама прошивка управляет — Serial идёт через
    // аппаратный UART0, не через провод, который рисует схема) — проверять
    // есть только verify.input.pin: вход, который стимулирует прошивку,
    // обязан встречаться концом провода на плате, как и у analog.
    it(`#${p.siteId} «${p.title}»: вход Serial-проверки подключён проводом в .vlx`, () => {
      const v = p.verify;
      const vlx = JSON.parse(readFileSync(join(DIR!, p.vlx), 'utf-8'));
      const boardIds = new Set((vlx.boards ?? []).map((b: any) => b.id));
      const wiredPins = new Set<string>();
      for (const w of vlx.wires ?? []) {
        for (const end of [w.start, w.end]) {
          if (end && boardIds.has(end.componentId)) wiredPins.add(String(end.pinName));
        }
      }
      expect(
        wiredPins.has(wireSideName(v.input.pin)),
        `#${p.siteId}: вывод ${v.input.pin} (${wireSideName(v.input.pin)}) не встречается концом провода в .vlx`,
      ).toBe(true);
    });
  }

  for (const p of behaviorChecked.filter((x: any) => x.verify?.kind === 'manual')) {
    checkedSiteIds.add(p.siteId);
  }

  it('ручные проверки не старше полугода', () => {
    // Иначе `manual` превращается в способ навсегда объявить проект
    // готовым, ни разу его больше не открыв.
    const halfYear = 183 * 24 * 3600 * 1000;
    for (const p of behaviorChecked.filter((x: any) => x.verify?.kind === 'manual')) {
      const at = Date.parse(p.verify.lastRun?.at ?? '');
      expect(Number.isFinite(at), `#${p.siteId}: нет даты ручной проверки`).toBe(true);
      expect(Date.now() - at, `#${p.siteId}: ручная проверка устарела`).toBeLessThan(halfYear);
    }
  });

  it('у каждой verified/needs-attention схемы зарегистрирована поведенческая проверка', () => {
    // Сам барьер (см. докстринг у checkedSiteIds выше, и у behaviorChecked
    // ещё выше). Ловит неизвестный verify.kind — и любую будущую форму,
    // которую сегодняшние циклы не предусматривают, — без необходимости
    // перечислять их здесь поимённо. Распространён на needs-attention
    // партией 9: до этого изменения барьер видел только verified, и четыре
    // схемы с заменённой деталью проходили бы мимо него — «зелено» при
    // отсутствии проверки для них же.
    const missing = behaviorChecked
      .filter((p: any) => !checkedSiteIds.has(p.siteId))
      .map((p: any) => `#${p.siteId} «${p.title}» (verify.kind=${p.verify?.kind ?? 'нет'})`);
    expect(missing, `без поведенческой проверки: ${missing.join(', ')}`).toEqual([]);
  });
});

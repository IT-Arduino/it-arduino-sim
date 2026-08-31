import { describe, it, expect } from 'vitest';
import { planWiring } from '../../scripts/siteProjects/wiring.mjs';

const BOARD = 'board1';
const EMPTY = { defines: {}, modes: [], lcd: null, servo: [], tone: [], analog: [] };

// Число проводов ничего не говорит о том, КУДА они идут: перепутанные
// TRIG/ECHO или сдвинутые на один D4..D7 дали бы то же количество wires.
// Сравниваем состав — набор пар «откуда:вывод → куда:вывод», а не счётчик.
const pairs = (wires) =>
  wires.map(
    (w) => `${w.start.componentId}:${w.start.pinName} → ${w.end.componentId}:${w.end.pinName}`,
  );

describe('правила трассировки', () => {
  it('светодиод: вывод → резистор → анод, катод → GND', () => {
    const { wires, unwired } = planWiring(
      { ...EMPTY, modes: [{ pin: 3, mode: 'OUTPUT' }] },
      [
        { id: 'led1', fork: 'led' },
        { id: 'r1', fork: 'resistor', props: { value: '220' } },
      ],
      BOARD,
    );
    expect(unwired).toEqual([]);
    expect(pairs(wires)).toEqual(['board1:3 → r1:1', 'r1:2 → led1:A', 'led1:C → board1:GND']);
  });

  it('светодиод выбирает резистор по номиналу 220 Ом, а не по позиции в списке', () => {
    // Итоговое ревью, IMPORTANT I7 / #32 «Фоторезистор»: BOM сайта
    // перечисляет резистор 10 кОм ПЕРЕД резистором 220 Ом. Позиционный
    // выбор resistors[i] взял бы 10 кОм для светодиода, а 220 Ом ушёл бы в
    // unwired — обратное тому, что нужно: 220 Ом токоограничивающий для
    // светодиода, 10 кОм относится ко второй половине схемы фоторезистора
    // (делитель напряжения), которую это правило не разводит вовсе.
    const { wires, unwired } = planWiring(
      { ...EMPTY, modes: [{ pin: 9, mode: 'OUTPUT' }] },
      [
        { id: 'r10k', fork: 'resistor', props: { value: '10000' } },
        { id: 'r220', fork: 'resistor', props: { value: '220' } },
        { id: 'led1', fork: 'led' },
      ],
      BOARD,
    );
    expect(pairs(wires)).toEqual(['board1:9 → r220:1', 'r220:2 → led1:A', 'led1:C → board1:GND']);
    expect(unwired).toEqual(['r10k']);
  });

  it('кнопка на INPUT_PULLUP: вывод → кнопка → GND', () => {
    const { wires } = planWiring(
      { ...EMPTY, modes: [{ pin: 2, mode: 'INPUT_PULLUP' }] },
      [{ id: 'btn1', fork: 'pushbutton' }],
      BOARD,
    );
    expect(pairs(wires)).toEqual(['board1:2 → btn1:1.l', 'btn1:2.l → board1:GND']);
  });

  it('кнопка на голом INPUT остаётся несоединённой — без внешней подтяжки 10 кОм', () => {
    // Итоговое ревью, IMPORTANT I7 / #34, #49: раньше кнопка на pinMode(pin,
    // INPUT) разводилась так же, как на INPUT_PULLUP — вывод → кнопка →
    // GND, без единственного, что на голом INPUT делает эту схему рабочей:
    // внешнего резистора 10 кОм на подтяжку. Правило его не ставит, значит
    // не соединяет вовсе — правдоподобная неправильная схема хуже честно
    // несобранной.
    const { wires, unwired } = planWiring(
      { ...EMPTY, modes: [{ pin: 2, mode: 'INPUT' }] },
      [{ id: 'btn1', fork: 'pushbutton' }],
      BOARD,
    );
    expect(wires).toEqual([]);
    expect(unwired).toEqual(['btn1']);
  });

  it('деталь без подходящего вывода остаётся несоединённой и названа', () => {
    // Молчание здесь недопустимо: каркас с неучтённой деталью выглядит
    // готовым, а работать не будет. wires уже сравнивается с [] дословно —
    // сильнее, чем длина, усиливать нечего.
    const { wires, unwired } = planWiring(EMPTY, [{ id: 'srv1', fork: 'servo' }], BOARD);
    expect(wires).toEqual([]);
    expect(unwired).toEqual(['srv1']);
  });

  it('лишние выводы делают привязку пина неоднозначной — светодиод остаётся несоединён', () => {
    // Итоговое ревью, IMPORTANT I7: раньше «лишний» вывод 4 просто
    // игнорировался, а светодиод получал outputs[0] — правдоподобно, но
    // это тоже угадывание: у 2 выводов-кандидатов на 1 светодиод генератор
    // не может знать, какой из них действительно ведёт к светодиоду, а
    // какой — к чему-то ещё. Не может решить однозначно — не подключает
    // вовсе (см. также #73/#68 ниже, тот же принцип на больших числах).
    const { wires, unwired } = planWiring(
      {
        ...EMPTY,
        modes: [
          { pin: 3, mode: 'OUTPUT' },
          { pin: 4, mode: 'OUTPUT' },
        ],
      },
      [
        { id: 'led1', fork: 'led' },
        { id: 'r1', fork: 'resistor', props: { value: '220' } },
      ],
      BOARD,
    );
    expect(wires).toEqual([]);
    expect(unwired.sort()).toEqual(['led1', 'r1']);
  });

  it('выводов больше, чем светодиодов (несколько) — все светодиоды остаются несоединены', () => {
    // Итоговое ревью, IMPORTANT I7 / #68 «Сканер отпечатка пальца»: 4
    // вывода OUTPUT, 2 светодиода в BOM — часть выводов на самом деле не
    // про светодиоды вовсе (у #68 это пины сканера). Позиционная пара
    // outputs[i] ↔ leds[i] для i=0,1 выглядела бы правдоподобно и была бы
    // не более чем угадыванием, какие именно 2 из 4 пинов светодиодные.
    const { wires, unwired } = planWiring(
      {
        ...EMPTY,
        modes: [
          { pin: 13, mode: 'OUTPUT' },
          { pin: 12, mode: 'OUTPUT' },
          { pin: 11, mode: 'OUTPUT' },
          { pin: 10, mode: 'OUTPUT' },
        ],
      },
      [
        { id: 'led1', fork: 'led' },
        { id: 'led2', fork: 'led' },
        { id: 'r1', fork: 'resistor', props: { value: '220' } },
        { id: 'r2', fork: 'resistor', props: { value: '220' } },
      ],
      BOARD,
    );
    expect(wires).toEqual([]);
    expect(unwired.sort()).toEqual(['led1', 'led2', 'r1', 'r2']);
  });

  it('зуммер: вывод из tone() → первый вывод детали, второй → GND', () => {
    const { wires, unwired } = planWiring(
      { ...EMPTY, tone: [8] },
      [{ id: 'bz1', fork: 'buzzer' }],
      BOARD,
    );
    expect(unwired).toEqual([]);
    expect(pairs(wires)).toEqual(['board1:8 → bz1:1', 'bz1:2 → board1:GND']);
  });

  it('потенциометр: 5В → крайний, средний → A<n>, второй крайний → GND', () => {
    const { wires, unwired } = planWiring(
      { ...EMPTY, analog: [0] },
      [{ id: 'pot1', fork: 'potentiometer' }],
      BOARD,
    );
    expect(unwired).toEqual([]);
    expect(pairs(wires)).toEqual([
      'board1:5V → pot1:VCC',
      'pot1:SIG → board1:A0',
      'pot1:GND → board1:GND',
    ]);
  });

  it('LCD1602: шесть линий из LiquidCrystal, плюс питание и подсветка', () => {
    const { wires, unwired } = planWiring(
      { ...EMPTY, lcd: [12, 11, 5, 4, 3, 2] },
      [{ id: 'lcd1', fork: 'lcd1602' }],
      BOARD,
    );
    expect(unwired).toEqual([]);
    expect(pairs(wires)).toEqual([
      'board1:12 → lcd1:RS',
      'board1:11 → lcd1:E',
      'board1:5 → lcd1:D4',
      'board1:4 → lcd1:D5',
      'board1:3 → lcd1:D6',
      'board1:2 → lcd1:D7',
      'board1:5V → lcd1:VDD',
      'board1:GND → lcd1:VSS',
      'board1:5V → lcd1:A',
      'board1:GND → lcd1:K',
    ]);
  });

  it('LCD1602: свободный потенциометр уходит на контраст V0', () => {
    // Проект #63 «Азбука Морзе»: LCD + один потенциометр в BOM, но
    // analogRead в коде нет — потенциометр целиком достаётся контрасту.
    const { wires, unwired } = planWiring(
      { ...EMPTY, lcd: [12, 11, 5, 4, 3, 2] },
      [
        { id: 'lcd1', fork: 'lcd1602' },
        { id: 'pot1', fork: 'potentiometer' },
      ],
      BOARD,
    );
    expect(unwired).toEqual([]);
    expect(pairs(wires)).toEqual([
      'board1:12 → lcd1:RS',
      'board1:11 → lcd1:E',
      'board1:5 → lcd1:D4',
      'board1:4 → lcd1:D5',
      'board1:3 → lcd1:D6',
      'board1:2 → lcd1:D7',
      'board1:5V → lcd1:VDD',
      'board1:GND → lcd1:VSS',
      'board1:5V → lcd1:A',
      'board1:GND → lcd1:K',
      'board1:5V → pot1:VCC',
      'pot1:GND → board1:GND',
      'pot1:SIG → lcd1:V0',
    ]);
  });

  it('LCD1602: свободный резистор 220 Ом уходит на токоограничение подсветки', () => {
    // Итоговое ревью, IMPORTANT I7/I9 / #63 «Азбука Морзе»: подсветка (A→
    // 5В, K→GND) раньше подключалась напрямую, без резистора — свободный
    // 220 Ом из BOM (в #63 в схеме нет ни одного светодиода, резистор
    // предназначен явно подсветке) всегда оставался в unwired рядом со
    // схемой, у которой state: verified — противоречие «схема собрана» и
    // «не вся». Резистор берётся, только если остался свободным после
    // правила светодиода выше (см. следующий тест — без резистора в BOM
    // подсветка остаётся напрямую, как раньше).
    const { wires, unwired } = planWiring(
      { ...EMPTY, lcd: [12, 11, 5, 4, 3, 2] },
      [
        { id: 'lcd1', fork: 'lcd1602' },
        { id: 'r1', fork: 'resistor', props: { value: '220' } },
      ],
      BOARD,
    );
    expect(unwired).toEqual([]);
    expect(pairs(wires)).toEqual([
      'board1:12 → lcd1:RS',
      'board1:11 → lcd1:E',
      'board1:5 → lcd1:D4',
      'board1:4 → lcd1:D5',
      'board1:3 → lcd1:D6',
      'board1:2 → lcd1:D7',
      'board1:5V → lcd1:VDD',
      'board1:GND → lcd1:VSS',
      'board1:5V → r1:1',
      'r1:2 → lcd1:A',
      'board1:GND → lcd1:K',
    ]);
  });

  it('HC-SR04: TRIG/ECHO из кода, VCC → 5В, GND → GND', () => {
    const { wires, unwired } = planWiring(
      {
        ...EMPTY,
        modes: [
          { pin: 9, mode: 'OUTPUT' },
          { pin: 10, mode: 'INPUT' },
        ],
      },
      [{ id: 'us1', fork: 'hc-sr04' }],
      BOARD,
    );
    expect(unwired).toEqual([]);
    expect(pairs(wires)).toEqual([
      'board1:9 → us1:TRIG',
      'us1:ECHO → board1:10',
      'board1:5V → us1:VCC',
      'us1:GND → board1:GND',
    ]);
  });

  it('сервопривод: сигнал из attach(), VCC → 5В, GND → GND', () => {
    const { wires, unwired } = planWiring(
      { ...EMPTY, servo: [9] },
      [{ id: 'sv1', fork: 'servo' }],
      BOARD,
    );
    expect(unwired).toEqual([]);
    expect(pairs(wires)).toEqual([
      'board1:9 → sv1:PWM',
      'board1:5V → sv1:V+',
      'sv1:GND → board1:GND',
    ]);
  });
});

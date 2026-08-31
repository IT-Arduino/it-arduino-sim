/**
 * Правила трассировки каркаса.
 *
 * Применяются только там, где вывод определён однозначно. Всё остальное
 * попадает в `unwired` — списком идентификаторов, чтобы человек, который
 * будет дособирать схему, сразу видел, что осталось.
 *
 * Имена выводов деталей — не из `components-metadata.json` (там только
 * `pinCount`, самих имён каталог не хранит): сверены с исходниками
 * `@wokwi/elements` (пакетом, которым реально рендерятся детали `wokwi-*`
 * в симуляторе) и с уже существующими схемами в `src/data/examples*.ts`,
 * где те же детали подключены теми же именами. Выдуманное имя даст
 * соединение, которого симулятор не увидит.
 */
let seq = 0;
const wireId = () => `w${++seq}`;

function wire(fromId, fromPin, toId, toPin, color = '#888') {
  return {
    id: wireId(),
    start: { componentId: fromId, pinName: fromPin, x: 0, y: 0 },
    end: { componentId: toId, pinName: toPin, x: 0, y: 0 },
    waypoints: [],
    color,
  };
}

export function planWiring(pins, components, boardId) {
  const wires = [];
  const used = new Set();
  const outputs = pins.modes.filter((m) => m.mode === 'OUTPUT').map((m) => m.pin);
  const inputs = pins.modes.filter((m) => m.mode !== 'OUTPUT');

  const leds = components.filter((c) => c.fork === 'led');
  const resistors = components.filter((c) => c.fork === 'resistor');
  const buttons = components.filter((c) => c.fork === 'pushbutton');
  // Подтяжка INPUT_PULLUP встроена в вывод; голый INPUT без внешнего
  // резистора 10 кОм физически не работает — этого резистора правило не
  // ставит, значит и не соединяет кнопку на голом INPUT вовсе (итоговое
  // ревью, IMPORTANT I7 / #34, #49: раньше такая кнопка разводилась как на
  // INPUT_PULLUP и помечалась собранной — правдоподобная неправильная
  // схема, которую спека прямо запрещает).
  const pullupInputs = pins.modes.filter((m) => m.mode === 'INPUT_PULLUP');

  // Кандидатов на вывод светодиода больше, чем самих светодиодов — часть
  // выводов принадлежит чему-то ещё (в #73 — энкодеру, в #68 — сканеру
  // отпечатка), и генератор не может решить, каким именно (итоговое
  // ревью, IMPORTANT I7). Не может решить однозначно — не подключает
  // вовсе, вместо того чтобы угадывать по порядку появления в коде.
  const ledPinAmbiguous = outputs.length > leds.length;

  leds.forEach((led, i) => {
    const pin = ledPinAmbiguous ? undefined : outputs[i];
    // Резистор — строго 220 Ом (правило спеки для светодиода), не первый
    // попавшийся: на #32 позиционный resistors[i] брал 10 кОм (там же в
    // BOM, для другой половины схемы — делителя фоторезистора) вместо
    // 220 Ом, а сам 220 Ом уходил в unwired.
    const res = resistors.find((r) => r.props?.value === '220' && !used.has(r.id));
    if (pin === undefined || !res) return;
    wires.push(wire(boardId, String(pin), res.id, '1', '#e74c3c'));
    wires.push(wire(res.id, '2', led.id, 'A', '#e74c3c'));
    wires.push(wire(led.id, 'C', boardId, 'GND', '#333'));
    used.add(led.id);
    used.add(res.id);
  });

  buttons.forEach((btn, i) => {
    const entry = pullupInputs[i];
    if (!entry) return;
    // wokwi-pushbutton — четыре вывода '1.l'/'2.l'/'1.r'/'2.r' (два
    // электрических узла по два вывода на каждый, см. докстринг выше).
    // Имён '1'/'2' у этой детали нет.
    wires.push(wire(boardId, String(entry.pin), btn.id, '1.l'));
    wires.push(wire(btn.id, '2.l', boardId, 'GND', '#333'));
    used.add(btn.id);
  });

  // Зуммер: вывод из tone() → первый вывод wokwi-buzzer ('1'/'2'), второй → GND.
  // tone(), а не pinMode: сайтовые скетчи включают зуммер через tone()/noTone(),
  // отдельного pinMode для него обычно нет.
  const buzzers = components.filter((c) => c.fork === 'buzzer');
  buzzers.forEach((buzzer, i) => {
    const pin = pins.tone[i];
    if (pin === undefined) return;
    wires.push(wire(boardId, String(pin), buzzer.id, '1', '#9b59b6'));
    wires.push(wire(buzzer.id, '2', boardId, 'GND', '#333'));
    used.add(buzzer.id);
  });

  // Потенциометр: 5В → крайний вывод (VCC), средний (SIG, движок) → A<n> из
  // analogRead(), второй крайний → GND. Одноимённая пара, свободная от этого
  // правила (нет своего analogRead), достаётся потенциометру контраста LCD
  // ниже — см. правило LCD1602.
  const potentiometers = components.filter((c) => c.fork === 'potentiometer');
  potentiometers.forEach((pot, i) => {
    const analogPin = pins.analog[i];
    if (analogPin === undefined) return;
    wires.push(wire(boardId, '5V', pot.id, 'VCC', '#e74c3c'));
    wires.push(wire(pot.id, 'SIG', boardId, `A${analogPin}`, '#f39c12'));
    wires.push(wire(pot.id, 'GND', boardId, 'GND', '#333'));
    used.add(pot.id);
  });

  // LCD1602 (режим 'full', 16 выводов по умолчанию — см. докстринг): шесть
  // линий из конструктора LiquidCrystal(rs, en, d4, d5, d6, d7) → RS/E/D4-D7,
  // плюс питание (VSS→GND, VDD→5В) и подсветка (A→5В, K→GND).
  const lcds = components.filter((c) => c.fork === 'lcd1602');
  lcds.forEach((lcd) => {
    if (!pins.lcd) return;
    const [rs, en, d4, d5, d6, d7] = pins.lcd;
    wires.push(wire(boardId, String(rs), lcd.id, 'RS'));
    wires.push(wire(boardId, String(en), lcd.id, 'E'));
    wires.push(wire(boardId, String(d4), lcd.id, 'D4'));
    wires.push(wire(boardId, String(d5), lcd.id, 'D5'));
    wires.push(wire(boardId, String(d6), lcd.id, 'D6'));
    wires.push(wire(boardId, String(d7), lcd.id, 'D7'));
    wires.push(wire(boardId, '5V', lcd.id, 'VDD', '#e74c3c'));
    wires.push(wire(boardId, 'GND', lcd.id, 'VSS', '#333'));

    // Подсветка (A/анод): через токоограничивающий резистор 220 Ом, если
    // такой остался свободным после правила светодиода выше — иначе
    // напрямую к 5В, как раньше (симулятору для остального поведения
    // схемы резистор не нужен, только для честности «деталь подключена»).
    // Итоговое ревью, IMPORTANT I7/I9 / #63 «Азбука Морзе»: подсветка
    // шла напрямую всегда, и свободный 220 Ом из BOM (в #63 в схеме нет ни
    // одного светодиода — резистор предназначен явно подсветке) вечно
    // оставался в unwired рядом со схемой в state: verified.
    const backlightRes = resistors.find((r) => r.props?.value === '220' && !used.has(r.id));
    if (backlightRes) {
      wires.push(wire(boardId, '5V', backlightRes.id, '1', '#e74c3c'));
      wires.push(wire(backlightRes.id, '2', lcd.id, 'A', '#e74c3c'));
      used.add(backlightRes.id);
    } else {
      wires.push(wire(boardId, '5V', lcd.id, 'A', '#e74c3c'));
    }
    wires.push(wire(boardId, 'GND', lcd.id, 'K', '#333'));
    used.add(lcd.id);

    // Потенциометр контраста на V0: берёт первый ещё не занятый
    // потенциометр из той же схемы (правило потенциометра выше уже
    // разобрало те, что читаются analogRead — этот, если остался, не
    // читается кодом вообще и предназначен только для контраста).
    const pot = potentiometers.find((p) => !used.has(p.id));
    if (pot) {
      wires.push(wire(boardId, '5V', pot.id, 'VCC', '#e74c3c'));
      wires.push(wire(pot.id, 'GND', boardId, 'GND', '#333'));
      wires.push(wire(pot.id, 'SIG', lcd.id, 'V0'));
      used.add(pot.id);
    }
  });

  // HC-SR04: TRIG — вывод из pinMode(..., OUTPUT), ECHO — из pinMode(...,
  // не-OUTPUT); оба выставляются в setup() рядом с trig/echo в коде датчика.
  // Индекс смещён на leds.length/buttons.length, чтобы не забрать пин,
  // который уже занят светодиодом или кнопкой из тех же массивов outputs/
  // inputs (в выборке эти детали с HC-SR04 не пересекаются, но смещение —
  // дешёвая страховка от невидимого наложения).
  const ultrasonics = components.filter((c) => c.fork === 'hc-sr04');
  ultrasonics.forEach((sensor, i) => {
    const trig = outputs[leds.length + i];
    const echo = inputs[buttons.length + i];
    if (trig === undefined || !echo) return;
    wires.push(wire(boardId, String(trig), sensor.id, 'TRIG'));
    wires.push(wire(sensor.id, 'ECHO', boardId, String(echo.pin)));
    wires.push(wire(boardId, '5V', sensor.id, 'VCC', '#e74c3c'));
    wires.push(wire(sensor.id, 'GND', boardId, 'GND', '#333'));
    used.add(sensor.id);
  });

  // Сервопривод: сигнал на вывод из .attach(), VCC → 5В (V+), GND → GND.
  const servos = components.filter((c) => c.fork === 'servo');
  servos.forEach((servo, i) => {
    const pin = pins.servo[i];
    if (pin === undefined) return;
    wires.push(wire(boardId, String(pin), servo.id, 'PWM', '#f39c12'));
    wires.push(wire(boardId, '5V', servo.id, 'V+', '#e74c3c'));
    wires.push(wire(servo.id, 'GND', boardId, 'GND', '#333'));
    used.add(servo.id);
  });

  const unwired = components.filter((c) => c.fork && !used.has(c.id)).map((c) => c.id);
  return { wires, unwired };
}

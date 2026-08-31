/**
 * Прогон прошивки с внешним цифровым сигналом на обычном (не аналоговом)
 * входном выводе.
 *
 * Тот же приём, что в runSketch.ts/runAnalog.ts: шагаем процессором вручную
 * вместо sim.start() — повторяемо, не зависит от загрузки машины.
 *
 * Зачем это нужно отдельно от pin-toggle/analog: часть проектов управляет
 * выходом ТОЛЬКО через digitalRead() обычного цифрового вывода (кнопка на
 * pinMode(pin, INPUT) без внутренней подтяжки, либо вовсе без pinMode —
 * вывод остаётся в состоянии по умолчанию после сброса). В голом прогоне
 * (без решения электрической схемы) такой вывод не подключён ни к чему —
 * никто не подаёт на него напряжение — и в модели ядра читается как
 * фиксированный низкий уровень: ни один toggle никогда не происходит,
 * сколько тактов ни давай. Дело не в количестве тактов (в отличие от
 * "обычного" pin-toggle, где дело именно в этом) — pin-toggle для такой
 * прошивки гарантированно и воспроизводимо покажет ноль переключений.
 *
 * Решение — то же, что уже принято для analog (verify.kind: "analog",
 * runAnalog.ts): не собирать электрическую цепь, а напрямую задать то
 * состояние вывода, которое реальная нарисованная схема туда бы подала.
 * Для аналоговых входов за это отвечает setAdcVoltage() из partUtils.ts;
 * для обычных цифровых входов — публичный, уже покрытый тестами метод
 * AVRSimulator.setPinState(pin, state), с документированным назначением
 * «Set the state of an Arduino pin externally (e.g. from a UI button)»
 * (см. AVRSimulator.ts, и его же использование в AVRSimulator.test.ts —
 * «setPinState drives external INPUT on the pin (like a button press)»).
 * Это не новый, специально для теста придуманный канал — тот же метод,
 * которым в интерактивном приложении управляет любая деталь, дёргающая
 * цифровой вывод платы извне.
 *
 * Как и setAdcVoltage, setPinState нужно вызывать ПОСЛЕ sim.loadHex() —
 * порты (portB/portC/portD) создаются внутри loadHex(), до этого вызов
 * просто ничего не сделает.
 *
 * delayCycles (партия 9, #40 «Игра в последовательность»): без него —
 * прежнее поведение, state подаётся СРАЗУ после loadHex(), до единого
 * step(). Для уровневого digitalRead() (#34/#75/#56) это ровно то, что
 * нужно — вывод либо подключён к постоянному внешнему уровню, либо нет,
 * момент подачи не важен. Для #40 это не сработало: pin2 там не читается
 * digitalRead(), а сидит на attachInterrupt(..., RISING) — нужен НАСТОЯЩИЙ
 * фронт (переход), а не уровень, заданный с самого начала (заданный ДО
 * первого step() уровень не даёт ядру зафиксировать переход с прежнего
 * состояния — измерено: 4 прогона по 10к/100к/1М/5М/20М тактов со
 * статическим pin2=true дали 0 событий на всех наблюдаемых пинах, притом
 * что LowPower.powerDown(SLEEP_FOREVER,...) в setup() усыпляет ядро
 * немедленно). Плюс в прошивке #40 есть собственный дебаунс на millis()
 * (threshold(): «if (millis()-debounce_time > 50) …») — переход должен
 * произойти уже ПОСЛЕ того, как виртуальное время перевалило за 50 мс с
 * старта, иначе тот же дебаунс проглотит и настоящий фронт. delayCycles —
 * сколько тактов вывод держит СВОЙ ПРЕЖНИЙ уровень (по умолчанию ядра —
 * LOW, см. докстринг runPinToggle.ts про сброс портов в 0) перед тем, как
 * runDigitalInput вызовет setPinState с заданным state — то есть настоящий
 * фронт посередине прогона, тем же приёмом, что уже применяет runSerial.ts
 * для аналогового входа (смена стимула не в начале, а на заданном шаге).
 * Подтверждено прямым прогоном на #40: статическая подача с t=0 не
 * производит ничего вплоть до 20М тактов; отложенная на 2М тактов (~125мс
 * при 16МГц, заведомо больше 50мс дебаунса) подача HIGH даёт первый
 * отклик (ШИМ на выводе LED[1]) уже через ~1.2М тактов после перехода.
 */
import { AVRSimulator } from '../../simulation/AVRSimulator';
import { PinManager } from '../../simulation/PinManager';

export interface DigitalInput {
  /** Вывод Arduino (любой цифровой, включая 14-19 = A0-A5 как цифровые). */
  pin: number;
  /** Внешний уровень, который реальная схема держала бы на этом выводе. */
  state: boolean;
  /**
   * Необязательно: сколько тактов вывод сохраняет свой прежний уровень
   * (по умолчанию ядра — LOW) перед тем, как будет подан `state`. Без
   * этого поля (или 0) — прежнее поведение: `state` подаётся сразу после
   * loadHex(), до единого step(). См. докстринг выше про #40.
   */
  delayCycles?: number;
}

export interface DigitalInputRunResult {
  /** Последняя известная скважность ШИМ (0..1) на выводе-выходе. */
  pwm: number;
  /** Последний известный цифровой уровень вывода-выхода. */
  level: boolean;
  /** Сколько раз вывод-выход поменял уровень за прогон. */
  toggleCount: number;
}

export function runDigitalInput(
  hex: string,
  board: 'uno' | 'mega' | 'tiny85',
  inputs: DigitalInput[],
  outputPin: number,
  cycles: number,
): DigitalInputRunResult {
  const pm = new PinManager();
  const sim = new AVRSimulator(pm, board);

  let toggleCount = 0;
  let level = false;
  pm.onPinChange(outputPin, (_pin, state) => {
    toggleCount++;
    level = state;
  });

  sim.loadHex(hex);

  // pollPwmRegisters() приватный — тот же приём, что уже использует
  // runAnalog.ts (и до него mega-emulation.test.ts): вызывается через
  // приведение типа, потому что обычный кадровый цикл AVRSimulator.start()
  // сюда не доходит — мы шагаем step() вручную.
  const pollPwm = (): void =>
    (sim as unknown as { pollPwmRegisters: () => void }).pollPwmRegisters();

  // См. докстринг выше — тот же метод, которым интерактивное приложение
  // подаёт внешний уровень на вывод (например, деталь-кнопка при клике).
  // Без delayCycles — прежнее поведение (state сразу, до единого step()).
  // С delayCycles — вывод держит прежний уровень до заданного такта, потом
  // получает настоящий фронт (нужно для edge/interrupt-driven входов, см.
  // докстринг про #40). Применяется в порядке возрастания delayCycles;
  // step() крутится только настолько, насколько нужно для очередной точки.
  const immediate = inputs.filter((inp) => !inp.delayCycles);
  const delayed = [...inputs.filter((inp) => inp.delayCycles)].sort(
    (a, b) => a.delayCycles! - b.delayCycles!,
  );
  for (const { pin, state } of immediate) sim.setPinState(pin, state);

  let stepped = 0;
  for (const { pin, state, delayCycles } of delayed) {
    while (stepped < delayCycles!) {
      sim.step();
      stepped++;
      if ((stepped & 0xff) === 0) pollPwm();
    }
    sim.setPinState(pin, state);
  }

  for (; stepped < cycles; stepped++) {
    sim.step();
    if ((stepped & 0xff) === 0) pollPwm();
  }
  pollPwm();
  sim.stop();

  return { pwm: pm.getPwmValue(outputPin), level, toggleCount };
}

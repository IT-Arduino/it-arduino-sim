/**
 * Прогон прошивки с внешним напряжением на аналоговом входе.
 *
 * Тот же приём, что в runSketch.ts/runLcd.ts: шагаем процессором вручную
 * вместо sim.start() — повторяемо, не зависит от загрузки машины. Спека
 * задачи изначально описывала вид проверки `analog` как «напряжение узла
 * после решения SPICE» — здесь так не сделано: SPICE для проверки «крутим
 * ручку — меняется отклик» не нужен, ADC можно накормить напряжением
 * напрямую, без решения электрической цепи.
 *
 * ОТСТУПЛЕНИЕ от чернового наброска этого помощника (был в рабочей копии
 * до коммита, без него в истории): черновик заводил напряжение через
 * PinManager.setAnalogVoltage(pin, voltage) + собственноручно подписанный
 * onAnalogChange-мост, вручную вычисляющий `channel = pin - 14` и пишущий
 * его в adc.channelValues. Проверено чтением всей кодовой базы (не только
 * PinManager/AVRSimulator, трогать которые запрещено, но и
 * simulation/parts/, трогать которые не запрещено, только читать) —
 * setAnalogVoltage в реальном приложении вообще не подключён к ADC: его
 * единственный вызывающий — customChips/ChipRuntime.ts:474, скриптовый API
 * для пользовательских чипов, к потенциометрам/сенсорам отношения не
 * имеющий. Деталь «Потенциометр», которую рисует этот же проект в .vlx
 * (ComplexParts.ts:95, правило 'potentiometer'), при повороте ручки
 * вызывает ДРУГУЮ функцию — setAdcVoltage() из simulation/parts/partUtils.ts
 * — которая и пишет то самое `adc.channelValues[pin-14] = voltage`
 * (partUtils.ts:84-90, для AVR). Черновик, по сути, повторно реализовал
 * эту функцию локально, вместо того чтобы вызвать её: тот же результат,
 * но с продублированной (и ничем не проверяемой на расхождение) формулой
 * смещения канала и без проверки диапазона вывода, которая уже есть в
 * оригинале. Использование настоящей setAdcVoltage() здесь и короче, и
 * достовернее — это буквально то же самое действие, которое проект
 * совершает при повороте ручки потенциометра на канвасе.
 *
 * Один мост всё же пришлось построить самому этому помощнику — готовой
 * связи в PinManager/AVRSimulator нет (проверено чтением обоих файлов):
 * onPwmChange()/getPwmValue() наполняются из AVRSimulator.pollPwmRegisters()
 * — приватного метода, который в обычной работе вызывает только кадровый
 * цикл start()/requestAnimationFrame, а не step(). Ручной пошаговый прогон
 * (как здесь и в runPinToggle/runLcdText) никогда его не вызывает —
 * getPwmValue() молча останется нулём. mega-emulation.test.ts уже вызывает
 * его тем же способом — (sim as any).pollPwmRegisters() — из тестового
 * файла, не трогая simulation/; тот же приём и с той же частотой опроса
 * здесь (каждые 256 тактов + один раз после цикла, как в настоящем
 * кадровом цикле AVRSimulator.start(), см. AVRSimulator.ts:870-882).
 *
 * Измерено отдельно (не только «связь работает», но и «где не работает»):
 * на паре проектов, где яркость светодиода линейно зависит от считанного с
 * потенциометра напряжения (аналоговый вход напрямую делится на постоянную
 * и подаётся в analogWrite), скважность 0.0 и 1.0 (напряжение 0В и 5В на
 * входе — оба конца диапазона) читаются ОДИНАКОВО через этот
 * путь — pollPwmRegisters не отличает «ШИМ активен со скважностью 0/1» от
 * «ШИМ вообще не идёт», getPwmValue в обоих случаях отдаёт 0. Середина
 * диапазона (1В..4В) читается корректно и однозначно (см. batch-2-report.md).
 * Отсюда практическое следствие для verify.input.low/high в манифесте:
 * подбирать значения, для которых pwm реально различим, а не бездумно брать
 * 0В/5В — сам помощник в это решение не вмешивается, он лишь честно
 * передаёт то, что видит.
 */
import { AVRSimulator } from '../../simulation/AVRSimulator';
import { PinManager } from '../../simulation/PinManager';
import { setAdcVoltage } from '../../simulation/parts/partUtils';

export interface AnalogInput {
  /** Вывод Arduino: 14-19 = A0-A5 на Uno/Mega. */
  pin: number;
  /** Напряжение, В (0-5). */
  voltage: number;
}

export interface AnalogRunResult {
  /** Последняя известная скважность ШИМ (0..1) на выводе-выходе. */
  pwm: number;
  /** Последний известный цифровой уровень вывода-выхода. */
  level: boolean;
  /** Сколько раз вывод-выход поменял уровень за прогон. */
  toggleCount: number;
}

export function runAnalog(
  hex: string,
  board: 'uno' | 'mega' | 'tiny85',
  inputs: AnalogInput[],
  outputPin: number,
  cycles: number,
): AnalogRunResult {
  const pm = new PinManager();
  const sim = new AVRSimulator(pm, board);

  let toggleCount = 0;
  let level = false;
  pm.onPinChange(outputPin, (_pin, state) => {
    toggleCount++;
    level = state;
  });

  sim.loadHex(hex);

  // Тот же вызов, которым Потенциометр реально управляет ADC при повороте
  // ручки (ComplexParts.ts:95) — см. докстринг выше. `adc` создаётся внутри
  // loadHex(), поэтому вызывать только после него.
  for (const { pin, voltage } of inputs) {
    const ok = setAdcVoltage(sim, pin, voltage);
    if (!ok) {
      throw new Error(
        `runAnalog: setAdcVoltage отказала для вывода ${pin} (плата ${board}) — ` +
          `не аналоговый канал этой платы (AVR: только 14-19 = A0-A5)`,
      );
    }
  }

  // pollPwmRegisters() приватный — вызывается через приведение типа, как
  // уже делает mega-emulation.test.ts. См. докстринг выше.
  const pollPwm = (): void =>
    (sim as unknown as { pollPwmRegisters: () => void }).pollPwmRegisters();

  for (let i = 0; i < cycles; i++) {
    sim.step();
    if ((i & 0xff) === 0) pollPwm();
  }
  pollPwm();
  sim.stop();

  return { pwm: pm.getPwmValue(outputPin), level, toggleCount };
}

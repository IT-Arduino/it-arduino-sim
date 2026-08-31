/**
 * Русские подписи свойств деталей.
 *
 * Продолжение componentNamesRu: свойства приходят из тех же метаданных
 * `@wokwi/elements` и так же минуют i18next. Панель свойств печатает
 * `prop.description || prop.name` (PartInspectorDialog:644), то есть ученик
 * видит либо английскую фразу из метаданных, либо и вовсе служебное имя поля
 * вроде `refreshMs` и `ledPower`.
 *
 * Отсюда две таблицы. Одна — по тексту описания, вторая — по имени свойства
 * для тех, у кого описания нет. Плюс уточнения для отдельных семейств
 * деталей: `value` у резистора это сопротивление, у конденсатора — ёмкость, у
 * потенциометра — положение движка. Одно слово «Значение» формально верно, но
 * ученику ничего не говорит.
 *
 * Незнакомое свойство показывается как было. Апстрим добавляет детали, и
 * английская подпись у новой детали лучше пустой строки.
 */

/** Подписи, которые в метаданных заданы английским описанием. */
const DESCRIPTION_RU: Record<string, string> = {
  'Altitude above mean sea level (m)': 'Высота над уровнем моря, м',
  'Coil resistance (Ω)': 'Сопротивление катушки, Ом',
  'DC for fixed rails, AC for sine waveform output': 'DC — постоянное напряжение, AC — синусоида',
  'DC offset in V': 'Постоянное смещение, В',
  'Frequency in Hz (AC mode only)': 'Частота, Гц (только в режиме AC)',
  'Frequency in Hz (ignored for DC)': 'Частота, Гц (в режиме DC не действует)',
  'I2C address (I2C mode)': 'Адрес I²C (в режиме I²C)',
  'I2C address of the PCF8574 backpack (typical: 0x27 or 0x3F)':
    'Адрес I²C модуля PCF8574 (обычно 0x27 или 0x3F)',
  'I2C address of the PCF8574 backpack': 'Адрес I²C модуля PCF8574',
  'I2C address': 'Адрес I²C',
  'Illumination in lux': 'Освещённость, лк',
  'Integrated flyback diode across coil': 'Встроенный защитный диод на катушке',
  'LCD panel colour': 'Цвет подложки экрана',
  'Latitude in decimal degrees (negative = south)': 'Широта в градусах (отрицательная — южная)',
  'Longitude in decimal degrees (negative = west)': 'Долгота в градусах (отрицательная — западная)',
  'Maximum sourced current in A. The verifier warns when exceeded.':
    'Предельный отдаваемый ток, А. При превышении проверка схемы предупредит.',
  'Nominal coil voltage (V)': 'Номинальное напряжение катушки, В',
  'On-chip temperature sensor (°C), readable at registers 0x11/0x12':
    'Встроенный датчик температуры, °C — регистры 0x11 и 0x12',
  'Output voltage in V (DC mode) or peak amplitude (AC mode)':
    'Выходное напряжение, В (режим DC) или амплитуда (режим AC)',
  'Peak amplitude in V (ignored for DC)': 'Амплитуда, В (в режиме DC не действует)',
  'Pixel colour': 'Цвет свечения',
  'Speed over ground (knots)': 'Скорость относительно земли, узлы',
};

/** Подписи для свойств без описания — там показывалось служебное имя поля. */
const NAME_RU: Record<string, string> = {
  angle: 'Угол',
  animation: 'Анимация',
  arrow: 'Стрелка',
  b: 'Синий (B)',
  background: 'Цвет подложки',
  backlight: 'Подсветка',
  blink: 'Мигание',
  blurLight: 'Размытие свечения',
  brightness: 'Яркость',
  characters: 'Символы',
  colSpacing: 'Шаг по столбцам',
  colon: 'Двоеточие',
  colonValue: 'Состояние двоеточия',
  color: 'Цвет',
  cols: 'Столбцов',
  columns: 'Столбцов',
  connector: 'Разъём',
  cursor: 'Курсор',
  cursorX: 'Курсор по X',
  cursorY: 'Курсор по Y',
  digits: 'Разрядов',
  endDegree: 'Конечный угол',
  flip: 'Отражение',
  flipHorizontal: 'Отразить по горизонтали',
  flipVertical: 'Отразить по вертикали',
  font: 'Шрифт',
  g: 'Зелёный (G)',
  hasSignal: 'Есть сигнал',
  horn: 'Рупор',
  hornColor: 'Цвет рупора',
  innerHandAngle: 'Угол внутренней стрелки',
  innerHandColor: 'Цвет внутренней стрелки',
  innerHandLength: 'Длина внутренней стрелки',
  innerHandShape: 'Форма внутренней стрелки',
  keys: 'Клавиши',
  label: 'Подпись',
  led1: 'Светодиод 1',
  led2: 'Светодиод 2',
  led13: 'Светодиод 13',
  ledBlue: 'Синий светодиод',
  ledBuiltIn: 'Встроенный светодиод',
  ledD0: 'Светодиод D0',
  ledDO: 'Светодиод DO',
  ledGreen: 'Зелёный светодиод',
  ledPower: 'Светодиод питания',
  ledRX: 'Светодиод RX',
  ledRed: 'Красный светодиод',
  ledSignal: 'Светодиод сигнала',
  ledTX: 'Светодиод TX',
  lightColor: 'Цвет свечения',
  max: 'Максимум',
  min: 'Минимум',
  offColor: 'Цвет в выключенном состоянии',
  outerHandAngle: 'Угол внешней стрелки',
  outerHandColor: 'Цвет внешней стрелки',
  outerHandLength: 'Длина внешней стрелки',
  outerHandShape: 'Форма внешней стрелки',
  panelKind: 'Тип панели',
  pins: 'Выводов',
  pixelSpacing: 'Шаг пикселей',
  pixels: 'Пикселей',
  pressed: 'Нажата',
  r: 'Красный (R)',
  refreshMs: 'Обновление, мс',
  resetPressed: 'Нажата кнопка сброса',
  rowSpacing: 'Шаг по строкам',
  rows: 'Строк',
  screenOnly: 'Только экран',
  size: 'Размер',
  startDegree: 'Начальный угол',
  step: 'Шаг',
  stepSize: 'Величина шага',
  travelLength: 'Длина хода',
  type: 'Тип',
  units: 'Единицы',
  value: 'Значение',
  values: 'Значения',
  voltage: 'Напряжение',
  waveform: 'Форма сигнала',
  xValue: 'Значение X',
  xray: 'Просвет (рентген)',
  yValue: 'Значение Y',
};

/**
 * Уточнения для отдельных семейств деталей.
 *
 * Свойство `value` есть у тридцати шести деталей, и «Значение» — подпись
 * формально верная и бесполезная. Ученику надо знать, что именно он правит:
 * сопротивление, ёмкость или положение движка.
 *
 * Ключ — начало идентификатора детали, чтобы одна строка покрывала всё
 * семейство: `resistor`, `resistor-220`, `resistor-4k7` и так далее.
 */
const BY_COMPONENT_PREFIX: Array<{ prefix: string; props: Record<string, string> }> = [
  { prefix: 'resistor', props: { value: 'Сопротивление' } },
  { prefix: 'cap-', props: { value: 'Ёмкость' } },
  { prefix: 'capacitor', props: { value: 'Ёмкость' } },
  { prefix: 'ind-', props: { value: 'Индуктивность' } },
  { prefix: 'inductor', props: { value: 'Индуктивность' } },
  { prefix: 'slide-potentiometer', props: { value: 'Положение движка' } },
  { prefix: 'potentiometer', props: { value: 'Положение движка' } },
];

/** Свойство детали в том виде, в каком его отдают метаданные. */
export interface ComponentProperty {
  name: string;
  description?: string;
}

/**
 * Подпись свойства по-русски.
 *
 * Порядок: уточнение для семейства деталей, затем перевод описания, затем
 * перевод имени поля. Ничего не нашлось — возвращаем то, что показывалось
 * раньше, чтобы новая деталь апстрима не осталась с пустой подписью.
 */
export function propertyLabelRu(prop: ComponentProperty, componentId?: string): string {
  if (componentId) {
    const family = BY_COMPONENT_PREFIX.find((f) => componentId.startsWith(f.prefix));
    const special = family?.props[prop.name];
    if (special) return special;
  }

  if (prop.description) {
    const byDescription = DESCRIPTION_RU[prop.description];
    if (byDescription) return byDescription;
  }

  const byName = NAME_RU[prop.name];
  if (byName) return byName;

  return prop.description || prop.name;
}

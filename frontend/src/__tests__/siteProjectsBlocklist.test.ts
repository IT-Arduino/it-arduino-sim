import { describe, it, expect } from 'vitest';
import { blockersFor, mapComponent } from '../../scripts/siteProjects/blocklist.mjs';

describe('разметка заблокированных', () => {
  it('плата ESP8266 блокирует проект', () => {
    expect(blockersFor([{ name: 'Arduino Wemos D1' }])).toEqual([
      'плата ESP8266 / Wemos D1 не поддерживается',
    ]);
  });

  it('DHT11 блокирует: в каталоге только DHT22, протоколы разные', () => {
    expect(blockersFor([{ name: 'DHT11' }])).toHaveLength(1);
  });

  it('обычная россыпь деталей ничего не блокирует', () => {
    expect(
      blockersFor([{ name: 'Arduino UNO' }, { name: 'Светодиод' }, { name: 'Резистор 220 Ом' }]),
    ).toEqual([]);
  });

  it('каждая причина попадает в список один раз', () => {
    expect(blockersFor([{ name: 'DHT11' }, { name: 'DHT11' }])).toHaveLength(1);
  });
});

describe('блокировка LCD с MCP23008 — по коду, а не по названию детали в BOM', () => {
  // Итоговое ревью, IMPORTANT I6 / п.2: решение раньше принималось по
  // строке "MCP23008-based, 32 LCD 16 x 2 (I2C)" в списке деталей сайта.
  // На настоящих данных это ошибается в обе стороны: #45 называет деталь
  // MCP23008, но код использует LiquidCrystal_I2C (PCF8574, есть в форке);
  // #78 называет деталь просто "LCD-экран WH1602", но код использует
  // Adafruit_LiquidCrystal (MCP23008, которого в форке нет).

  it('#45 «Секундомер»: BOM говорит MCP23008, код — LiquidCrystal_I2C (PCF8574) → не блокирует', () => {
    // Своя реконструкция структуры, не текст сайта: реальный код #45 несёт
    // закомментированный вызов обычного (параллельного) LiquidCrystal перед
    // настоящим LiquidCrystal_I2C — decoy-строка ниже той же формы (другими
    // словами и другими цифрами), чтобы проверить, что разбор не путает
    // закомментированный конструктор с настоящим.
    const code = [
      '#include <LiquidCrystal_I2C.h>',
      '// старое подключение по шести проводам, оставлено для памяти:',
      '// LiquidCrystal display(8, 9, 4, 5, 6, 7);',
      'LiquidCrystal_I2C display(0x27, 16, 2);',
    ].join('\n');
    expect(blockersFor([{ name: 'MCP23008-based, 32 LCD 16 x 2 (I2C)' }], code)).toEqual([]);
  });

  it('#78 «Таймер обратного отчета»: BOM молчит про MCP23008, код — Adafruit_LiquidCrystal → блокирует', () => {
    const code = ['#include <Adafruit_LiquidCrystal.h>', 'Adafruit_LiquidCrystal display(0);'].join(
      '\n',
    );
    expect(blockersFor([{ name: 'LCD-экран WH1602' }], code)).toEqual([
      'переходник MCP23008 для LCD (в форке PCF8574)',
    ]);
  });

  it('#60 «Электронный замок»: тот же конструктор, что у #78 — остаётся заблокирован', () => {
    const code = ['#include <Adafruit_LiquidCrystal.h>', 'Adafruit_LiquidCrystal panel(0);'].join(
      '\n',
    );
    expect(blockersFor([{ name: 'MCP23008-based, 32 LCD 16 x 2 (I2C)' }], code)).toEqual([
      'переходник MCP23008 для LCD (в форке PCF8574)',
    ]);
  });

  it('без кода (или без LCD в коде вовсе) название детали само по себе больше не блокирует', () => {
    expect(blockersFor([{ name: 'MCP23008-based, 32 LCD 16 x 2 (I2C)' }])).toEqual([]);
  });
});

describe('соответствие деталей', () => {
  it('светодиод и резистор ложатся на детали форка', () => {
    expect(mapComponent('Светодиод').fork).toBe('led');
    expect(mapComponent('Резистор 220 Ом')).toEqual({ fork: 'resistor', props: { value: '220' } });
  });

  it('деталь "MCP23008-based" LCD ложится на I2C-вариант каталога, не на параллельный lcd1602', () => {
    // Тот же дисплей физически (16x2, HD44780) — но #45 подключает его по
    // I2C (LiquidCrystal_I2C), не шестью параллельными линиями. lcd1602-i2c
    // — отдельная деталь каталога специально под этот случай (4 вывода:
    // GND/VCC/SDA/SCL, см. components-metadata.json).
    expect(mapComponent('MCP23008-based, 32 LCD 16 x 2 (I2C)')).toEqual({ fork: 'lcd1602-i2c' });
  });

  it('провода и макетная плата не детали схемы', () => {
    // Отказ с причиной, а не молчаливый пропуск: иначе непонятно,
    // деталь потеряли или сознательно не ставили.
    expect(mapComponent('Провода')).toEqual({ fork: null, why: 'не деталь схемы' });
  });

  it('незнакомое имя возвращает пустое соответствие, а не падает', () => {
    expect(mapComponent('Неведомая деталь').fork).toBeNull();
  });
});

/**
 * Детали, которых нет в каталоге форка, и потому проект не собрать.
 *
 * Замена детали запрещена: код скетча дословный, а другая деталь означала
 * бы другой протокол на выводе. DHT11 и DHT22 — ровно этот случай: деталь
 * похожа, обмен разный, и подмена дала бы схему, которая молча не читает
 * датчик.
 */
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { stripCommentsAndStrings } from './pins.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const MAPPING = JSON.parse(readFileSync(join(here, 'mapping.json'), 'utf-8'));

const BLOCKERS = {
  'Arduino Wemos D1': 'плата ESP8266 / Wemos D1 не поддерживается',
  'Беспроводной Wi-Fi модуль ESP8266-01S': 'плата ESP8266 / Wemos D1 не поддерживается',
  DHT11: 'DHT11: в каталоге только DHT22, протоколы разные',
  'Bluetooth HC-05': 'Bluetooth HC-05',
  'Двигатель DC': 'мотор постоянного тока',
  'RFID MFRC522': 'RFID MFRC522',
  'Датчик уровня жидкости': 'датчик уровня жидкости',
  'Датчик влажности почвы': 'датчик влажности почвы',
  'Водяной насос для полива': 'насос',
  'Модуль лазера (KY-008)': 'лазерный модуль KY-008',
  'FM-радио TEA5767': 'FM-приёмник TEA5767',
  TTP223: 'сенсорная кнопка TTP223',
};

const MCP23008_LCD_REASON = 'переходник MCP23008 для LCD (в форке PCF8574)';

// LCD с I2C-переходником: два конструктора выглядят по-разному в коде и
// требуют разных переходников. LiquidCrystal_I2C — PCF8574, каталог форка
// его содержит. Adafruit_LiquidCrystal — MCP23008, которого нет.
//
// Раньше решение принималось по названию детали в BOM сайта
// ("MCP23008-based, 32 LCD 16 x 2 (I2C)"), и это ошибалось в обе стороны на
// настоящих данных: #45 «Секундомер» называет деталь MCP23008, но код —
// LiquidCrystal_I2C (ложная блокировка); #78 «Таймер обратного отчета»
// называет деталь просто "LCD-экран WH1602", а код — Adafruit_LiquidCrystal
// (пропущенная блокировка). Спека прямо оставляла это открытым вопросом
// («Открытые вопросы») и требовала проверить при разборе — код единственный
// надёжный источник, название детали в BOM сайта им не является.
const ADAFRUIT_LCD_CTOR = /\bAdafruit_LiquidCrystal\s+\w+\s*\(/;

function lcdMcp23008Blocker(code) {
  if (!code) return null;
  const cleaned = stripCommentsAndStrings(String(code));
  return ADAFRUIT_LCD_CTOR.test(cleaned) ? MCP23008_LCD_REASON : null;
}

export function blockersFor(components, code) {
  const out = new Set();
  for (const c of components ?? []) {
    const reason = BLOCKERS[String(c.name ?? '').trim()];
    if (reason) out.add(reason);
  }
  const lcdReason = lcdMcp23008Blocker(code);
  if (lcdReason) out.add(lcdReason);
  return [...out];
}

export function mapComponent(name) {
  return MAPPING[String(name ?? '').trim()] ?? { fork: null, why: 'нет соответствия в таблице' };
}

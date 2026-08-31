import { describe, it, expect } from 'vitest';
import { extractPins } from '../../scripts/siteProjects/pins.mjs';

describe('разбор выводов', () => {
  it('берёт числовые #define', () => {
    expect(extractPins('#define LED 13\n').defines).toEqual({ LED: 13 });
  });

  it('берёт const int', () => {
    expect(extractPins('const int BUZZER = 8;').defines).toEqual({ BUZZER: 8 });
  });

  it('разрешает pinMode через имя', () => {
    const out = extractPins('#define LED 13\nvoid setup(){pinMode(LED, OUTPUT);}');
    expect(out.modes).toEqual([{ pin: 13, mode: 'OUTPUT' }]);
  });

  it('берёт выводы LiquidCrystal', () => {
    expect(extractPins('LiquidCrystal lcd(2, 3, 4, 5, 6, 7);').lcd).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it('берёт вывод servo.attach', () => {
    expect(extractPins('myservo.attach(9);').servo).toEqual([9]);
  });

  it('берёт аналоговые выводы', () => {
    expect(extractPins('int v = analogRead(A0);').analog).toEqual([0]);
  });

  it('НЕ выдумывает выводы, когда они вычисляются', () => {
    // «Бегущий огонек»: выводы получаются циклом из двух констант.
    // Молчаливая догадка здесь дала бы правдоподобную неверную схему —
    // худший исход из возможных.
    const out = extractPins(
      '#define FIRST 2\n#define LAST 6\nvoid setup(){for(int p=FIRST;p<=LAST;++p) pinMode(p, OUTPUT);}',
    );
    expect(out.modes).toEqual([]);
  });

  it('(а) НЕ читает pinMode из комментариев', () => {
    // Проект #73 «Регулятор мощности»: pinMode(...) с хвостовым
    // комментарием на той же строке, поясняющим код по-русски (см. task-7 в
    // progress.md). Старая реализация выдумает вывод 13 из комментария
    // внутри скобок.
    const out = extractPins('pinMode(13, 1);       // хвостовой комментарий на той же строке');
    // 1 не is OUTPUT/INPUT/INPUT_PULLUP, поэтому не должно быть modes
    expect(out.modes).toEqual([]);
  });

  it('(б) разбирает #define с хвостовым комментарием', () => {
    // Проект #82 «Лазер» и другие: #define с хвостовым комментарием на той
    // же строке — самый частый стиль в корпусе сайта (см. task-7 в
    // progress.md).
    const out = extractPins('#define LASER 10 // хвостовой комментарий на той же строке');
    expect(out.defines).toEqual({ LASER: 10 });
  });

  it('(в) разрешает servo.attach с именем константы', () => {
    // Проект #54 «Умная урна»: вида
    // #define servoPin 4
    // servo.attach(servoPin)
    const out = extractPins('#define servoPin 4\nservo.attach(servoPin);');
    expect(out.servo).toEqual([4]);
  });

  it('(1) НЕ читает pinMode из символьного литерала с двойной кавычкой', () => {
    // Проблема: if (c == '"') { } pinMode(7, OUTPUT); — двойная кавычка
    // внутри символьного литерала '…' должна не скалывать парсер.
    const out = extractPins("if (c == '\"') { } pinMode(7, OUTPUT);");
    // Вывод 7 с OUTPUT должен быть найден
    expect(out.modes).toEqual([{ pin: 7, mode: 'OUTPUT' }]);
  });

  it('(2) НЕ выдумывает #define с выражением', () => {
    // Проблема: #define X 5*2 — это вычисляемая константа, не должна
    // попасть в defines как X=5.
    const out = extractPins('#define X 5*2');
    // X не должно быть в defines вообще
    expect(out.defines).toEqual({});
  });
});

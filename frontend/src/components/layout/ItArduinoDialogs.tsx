/**
 * ItArduinoDialogs — все окна форка одной точкой монтирования.
 *
 * Существует ради одной строки в чужом файле. Оба окна («Сохранить в проект»
 * и «Мои схемы») живут в порталах и должны быть в дереве React постоянно,
 * иначе им некуда открыться. Монтировать их по отдельности значило бы править
 * EditorPage дважды сейчас и ещё по разу на каждое будущее окно — а каждая
 * правка чужого файла оплачивается конфликтом при слиянии с апстримом.
 *
 * Ничего не рендерит, пока окна закрыты.
 */
import React from 'react';

import { MyCircuitsDialog } from './MyCircuitsDialog';
import { ReadOnlyBanner } from './ReadOnlyBanner';
import { SaveCircuitDialog } from './SaveCircuitDialog';

export const ItArduinoDialogs: React.FC = () => (
  <>
    <SaveCircuitDialog />
    <MyCircuitsDialog />
    {/* Не окно, но живёт по тем же правилам: портал, пусто вне своего режима,
        монтируется здесь же — чтобы EditorPage не правился второй раз. */}
    <ReadOnlyBanner />
  </>
);

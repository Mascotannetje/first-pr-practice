import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addMonths,
  checkEligibility,
  createClaim,
  daysBetween,
  generateClaimNumber,
  updateClaimStatus,
  validateDetails,
  validateOrder,
} from '../js/claims.js';
import { createStore } from '../js/store.js';

const TODAY = new Date('2026-10-20T00:00:00Z');
const ORDER = { name: 'Sam de Vries', email: 'Sam@Example.nl ', orderNumber: '100234', orderDate: '2026-10-01' };

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
}

test('generateClaimNumber gebruikt het OFS-formaat zonder verwarrende tekens', () => {
  assert.match(generateClaimNumber(), /^OFS-[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(generateClaimNumber(() => 0), 'OFS-AAAAAA');
});

test('daysBetween en addMonths rekenen met kalenderdagen', () => {
  assert.equal(daysBetween(new Date('2026-10-01T23:00:00Z'), TODAY), 19);
  assert.equal(addMonths(new Date('2024-01-31T00:00:00Z'), 1).toISOString().slice(0, 10), '2024-02-29');
});

test('validateOrder keurt een correcte bestelling goed', () => {
  assert.deepEqual(validateOrder(ORDER, TODAY), {});
});

test('validateOrder meldt ontbrekende en foute velden', () => {
  const errors = validateOrder({ name: '', email: 'geen-mail', orderNumber: '#1', orderDate: '2027-01-01' }, TODAY);
  assert.deepEqual(Object.keys(errors).sort(), ['email', 'name', 'orderDate', 'orderNumber']);
});

test('retour vereist artikel, reden, oplossing en ontvangstdatum', () => {
  const errors = validateDetails('retour', { items: [{ product: '', quantity: 1 }] }, ORDER, TODAY);
  assert.deepEqual(Object.keys(errors).sort(), ['items', 'reason', 'receivedDate', 'resolution']);

  const valid = {
    items: [{ product: 'Overshirt M', quantity: 1 }],
    reason: 'te_groot',
    resolution: 'ruilen',
    receivedDate: '2026-10-03',
  };
  assert.deepEqual(validateDetails('retour', valid, ORDER, TODAY), {});
  assert.ok(validateDetails('retour', { ...valid, reason: 'anders' }, ORDER, TODAY).explanation);
  assert.ok(validateDetails('retour', { ...valid, receivedDate: '2026-09-01' }, ORDER, TODAY).receivedDate);
  assert.ok(validateDetails('retour', { ...valid, items: [{ product: 'X', quantity: 0 }] }, ORDER, TODAY).items);
});

test('garantie vereist foto en een duidelijke omschrijving', () => {
  const details = { product: 'Tote bag', description: 'Kapot', resolution: 'vervanging', photos: [] };
  const errors = validateDetails('garantie', details, ORDER, TODAY);
  assert.deepEqual(Object.keys(errors).sort(), ['description', 'photos']);

  const valid = { ...details, description: 'Het hengsel is na twee weken losgescheurd.', photos: ['data:'] };
  assert.deepEqual(validateDetails('garantie', valid, ORDER, TODAY), {});
});

test('niet geleverd: buren checken bij "bezorgd" en artikelen bij onvolledig', () => {
  const base = { carrier: 'postnl', address: 'Straat 1, Utrecht' };
  assert.ok(validateDetails('niet-geleverd', { ...base, issue: 'bezorgd_niet_ontvangen' }, ORDER, TODAY).checkedNeighbours);
  assert.deepEqual(
    validateDetails('niet-geleverd', { ...base, issue: 'bezorgd_niet_ontvangen', checkedNeighbours: true }, ORDER, TODAY),
    {},
  );
  assert.ok(validateDetails('niet-geleverd', { ...base, issue: 'onvolledig', items: [] }, ORDER, TODAY).items);
});

test('validateDetails weigert onbekende types', () => {
  assert.ok(validateDetails('cadeau', {}, ORDER, TODAY).type);
});

test('checkEligibility waarschuwt buiten de termijnen', () => {
  assert.equal(checkEligibility('retour', { receivedDate: '2026-10-01' }, ORDER, TODAY).length, 0);
  assert.equal(checkEligibility('retour', { receivedDate: '2026-09-01' }, ORDER, TODAY).length, 1);

  assert.equal(checkEligibility('garantie', {}, { orderDate: '2025-01-01' }, TODAY).length, 0);
  assert.equal(checkEligibility('garantie', {}, { orderDate: '2024-10-19' }, TODAY).length, 1);

  assert.equal(checkEligibility('niet-geleverd', { issue: 'niets_ontvangen' }, { orderDate: '2026-10-18' }, TODAY).length, 1);
  assert.equal(checkEligibility('niet-geleverd', { issue: 'niets_ontvangen' }, ORDER, TODAY).length, 0);
});

test('createClaim normaliseert gegevens en start de historie', () => {
  const claim = createClaim({ type: 'retour', order: ORDER, details: { receivedDate: '2026-09-01' } }, TODAY, () => 0);
  assert.equal(claim.number, 'OFS-AAAAAA');
  assert.equal(claim.status, 'ontvangen');
  assert.equal(claim.order.email, 'sam@example.nl');
  assert.equal(claim.history.length, 1);
  assert.equal(claim.warnings.length, 1);
});

test('updateClaimStatus voegt een historieregel toe zonder het origineel te wijzigen', () => {
  const claim = createClaim({ type: 'garantie', order: ORDER, details: {} }, TODAY);
  const later = new Date('2026-10-21T10:00:00Z');
  const updated = updateClaimStatus(claim, 'goedgekeurd', ' We sturen een nieuwe. ', later);
  assert.equal(updated.status, 'goedgekeurd');
  assert.equal(updated.history.at(-1).note, 'We sturen een nieuwe.');
  assert.equal(claim.history.length, 1);
  assert.throws(() => updateClaimStatus(claim, 'onbekend'));
});

test('store: klant vindt claim alleen met juist claimnummer én e-mail', () => {
  const store = createStore(memoryStorage());
  const claim = store.add(createClaim({ type: 'retour', order: ORDER, details: {} }, TODAY));
  assert.equal(store.findForCustomer(claim.number.toLowerCase(), ' SAM@example.nl')?.number, claim.number);
  assert.equal(store.findForCustomer(claim.number, 'iemand@anders.nl'), null);
  assert.equal(store.findForCustomer('OFS-NOPE00', 'sam@example.nl'), null);
});

test('store: dubbele claimnummers worden vervangen en opslaan werkt bij', () => {
  const store = createStore(memoryStorage());
  const first = store.add(createClaim({ type: 'retour', order: ORDER, details: {} }, TODAY, () => 0));
  const second = store.add(createClaim({ type: 'retour', order: ORDER, details: {} }, TODAY, () => 0));
  assert.notEqual(first.number, second.number);
  assert.equal(store.list().length, 2);

  store.save(updateClaimStatus(first, 'afgerond', '', TODAY));
  assert.equal(store.get(first.number).status, 'afgerond');
});

import {
  CARRIERS,
  CLAIM_TYPES,
  DELIVERY_ISSUES,
  RETURN_REASONS,
  RETURN_RESOLUTIONS,
  RETURN_WINDOW_DAYS,
  STATUSES,
  WARRANTY_MONTHS,
  WARRANTY_RESOLUTIONS,
  checkEligibility,
  createClaim,
  updateClaimStatus,
  validateDetails,
  validateOrder,
} from './claims.js';
import { createStore } from './store.js';

const MAX_PHOTOS = 4;
const PHOTO_MAX_SIZE = 1000;

const store = createStore();
const app = document.getElementById('app');

const state = {
  wizard: null,
  lookup: { number: '', email: '', result: undefined },
  admin: { type: '', status: '', query: '', open: null, message: '' },
};

// ---------- Hulpfuncties ----------

function esc(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function todayISO() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

// Termijnen rekenen met kalenderdagen; middernacht UTC voorkomt tijdzone-randgevallen.
function today() {
  return new Date(`${todayISO()}T00:00:00Z`);
}

function formatDate(value) {
  if (!value) return '';
  const date = value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(value);
  return date.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatDateTime(value) {
  return new Date(value).toLocaleString('nl-NL', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getPath(object, path) {
  return path.split('.').reduce((acc, key) => (acc == null ? undefined : acc[key]), object);
}

function setPath(object, path, value) {
  const keys = path.split('.');
  const last = keys.pop();
  const target = keys.reduce((acc, key) => acc[key], object);
  target[last] = value;
}

function field({ label, name, error, hint, control, optional }) {
  return `
    <div class="field ${error ? 'has-error' : ''}" data-field="${esc(name)}">
      <label for="${esc(name)}">${esc(label)}${optional ? ' <span class="optional">(optioneel)</span>' : ''}</label>
      ${hint ? `<p class="hint" id="${esc(name)}-hint">${esc(hint)}</p>` : ''}
      ${control}
      ${error ? `<p class="error" id="${esc(name)}-error" role="alert">${esc(error)}</p>` : ''}
    </div>`;
}

function describedBy(name, error, hint) {
  const ids = [hint && `${name}-hint`, error && `${name}-error`].filter(Boolean);
  return ids.length ? `aria-describedby="${esc(ids.join(' '))}"` : '';
}

function input(name, value, { type = 'text', error, hint, ...attrs } = {}) {
  const extra = Object.entries(attrs)
    .map(([key, val]) => (val === true ? key : `${key}="${esc(val)}"`))
    .join(' ');
  return `<input id="${esc(name)}" name="${esc(name)}" type="${type}" data-bind="${esc(name)}"
    value="${esc(value)}" ${error ? 'aria-invalid="true"' : ''} ${describedBy(name, error, hint)} ${extra}>`;
}

function textarea(name, value, { error, hint, rows = 4 } = {}) {
  return `<textarea id="${esc(name)}" name="${esc(name)}" data-bind="${esc(name)}" rows="${rows}"
    ${error ? 'aria-invalid="true"' : ''} ${describedBy(name, error, hint)}>${esc(value)}</textarea>`;
}

function select(name, options, value, { error, placeholder = 'Maak een keuze', rerender, bind = true } = {}) {
  return `<select id="${esc(name)}" name="${esc(name)}" ${bind ? `data-bind="${esc(name)}"` : ''} ${rerender ? 'data-rerender' : ''}
      ${error ? 'aria-invalid="true"' : ''} ${describedBy(name, error)}>
      <option value="">${esc(placeholder)}</option>
      ${Object.entries(options)
        .map(([key, label]) => `<option value="${esc(key)}" ${key === value ? 'selected' : ''}>${esc(label)}</option>`)
        .join('')}
    </select>`;
}

function choiceCards(name, options, value, { error } = {}) {
  return `<div class="choices" role="radiogroup" id="${esc(name)}" ${describedBy(name, error)}>
      ${Object.entries(options)
        .map(
          ([key, label]) => `
        <label class="choice">
          <input type="radio" name="${esc(name)}" value="${esc(key)}" data-bind="${esc(name)}" ${key === value ? 'checked' : ''}>
          <span>${esc(label)}</span>
        </label>`,
        )
        .join('')}
    </div>`;
}

function statusBadge(status) {
  return `<span class="badge badge-${esc(status)}">${esc(STATUSES[status] ?? status)}</span>`;
}

function typeIcon(type) {
  const icons = {
    retour:
      '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    garantie:
      '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="m9 12 2 2 4-4"/>',
    'niet-geleverd':
      '<path d="M16.5 9.4 7.55 4.24"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96 12 12.01l8.73-5.05"/><path d="M12 22.08V12"/>',
    status: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>',
  };
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[type]}</svg>`;
}

// ---------- Samenvatting van een claim (gedeeld door controle, status en beheer) ----------

function itemsText(items) {
  return (items ?? [])
    .filter((item) => item.product?.trim())
    .map((item) => `${item.quantity}× ${item.product.trim()}`)
    .join(', ');
}

function detailRows(type, details) {
  if (type === 'retour') {
    return [
      ['Artikelen', itemsText(details.items)],
      ['Ontvangen op', formatDate(details.receivedDate)],
      ['Reden', RETURN_REASONS[details.reason]],
      ['Toelichting', details.explanation],
      ['Gewenste oplossing', RETURN_RESOLUTIONS[details.resolution]],
    ];
  }
  if (type === 'garantie') {
    return [
      ['Product', details.product],
      ['Maat / kleur', details.variant],
      ['Omschrijving', details.description],
      ['Gewenste oplossing', WARRANTY_RESOLUTIONS[details.resolution]],
    ];
  }
  return [
    ['Probleem', DELIVERY_ISSUES[details.issue]],
    ['Vervoerder', CARRIERS[details.carrier]],
    ['Track & trace', details.tracking],
    ['Bezorgadres', details.address],
    ['Ontbrekende artikelen', details.issue === 'onvolledig' ? itemsText(details.items) : ''],
    ['Buren en brievenbus gecheckt', details.issue === 'bezorgd_niet_ontvangen' ? 'Ja' : ''],
    ['Toelichting', details.explanation],
  ];
}

function summary(type, order, details) {
  const rows = [
    ['Type', CLAIM_TYPES[type].label],
    ['Naam', order.name],
    ['E-mail', order.email],
    ['Ordernummer', order.orderNumber],
    ['Besteldatum', formatDate(order.orderDate)],
    ...detailRows(type, details),
  ].filter(([, value]) => value && String(value).trim());
  const photos = details.photos?.length
    ? `<div class="photos">${details.photos
        .map((src, i) => `<img src="${esc(src)}" alt="Foto ${i + 1} van het gebrek">`)
        .join('')}</div>`
    : '';
  return `<dl class="summary">${rows
    .map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`)
    .join('')}</dl>${photos}`;
}

function timeline(history) {
  return `<ol class="timeline">${[...history]
    .reverse()
    .map(
      (entry) => `
      <li>
        <div class="timeline-head">${statusBadge(entry.status)}<time>${esc(formatDateTime(entry.at))}</time></div>
        ${entry.note ? `<p>${esc(entry.note)}</p>` : ''}
      </li>`,
    )
    .join('')}</ol>`;
}

function warningsBox(warnings) {
  if (!warnings?.length) return '';
  return `<div class="notice notice-warning" role="status">${warnings.map((w) => `<p>${esc(w)}</p>`).join('')}</div>`;
}

// ---------- Startpagina ----------

function renderHome() {
  const cards = Object.entries(CLAIM_TYPES)
    .map(
      ([key, type]) => `
      <a class="card card-link" href="#/claim/${key}">
        ${typeIcon(key)}
        <h2>${esc(type.title)}</h2>
        <p>${esc(type.description)}</p>
        <span class="card-cta">Start ${esc(type.label.toLowerCase())} <span aria-hidden="true">→</span></span>
      </a>`,
    )
    .join('');

  return `
    <section class="hero">
      <p class="eyebrow">Klantenservice</p>
      <h1>Hoe kunnen we je helpen?</h1>
      <p class="lead">Kies wat er aan de hand is. Binnen een paar minuten heb je je claim ingediend en je ontvangt direct een claimnummer.</p>
    </section>
    <section class="grid" aria-label="Soort claim">${cards}</section>
    <section class="card status-teaser">
      ${typeIcon('status')}
      <div>
        <h2>Al een claim ingediend?</h2>
        <p>Bekijk de status met je claimnummer en e-mailadres.</p>
      </div>
      <a class="button button-secondary" href="#/status">Status bekijken</a>
    </section>
    <section class="faq">
      <h2>Veelgestelde vragen</h2>
      <details>
        <summary>Hoe lang heb ik om iets te retourneren?</summary>
        <p>Je kunt artikelen tot ${RETURN_WINDOW_DAYS} dagen na ontvangst retourneren, mits ongedragen en met labels eraan.</p>
      </details>
      <details>
        <summary>Hoe lang geldt de garantie?</summary>
        <p>Op onze producten zit minimaal ${WARRANTY_MONTHS} maanden garantie op fabricagefouten. Normale slijtage en schade door verkeerd gebruik vallen hier niet onder.</p>
      </details>
      <details>
        <summary>Mijn pakket staat op bezorgd, maar ik heb niets ontvangen.</summary>
        <p>Check eerst bij je buren, je brievenbus en het afhaalpunt in de buurt. Nog steeds niets? Dien dan een claim "Niet geleverd" in, dan zoeken we het samen met de vervoerder uit.</p>
      </details>
      <details>
        <summary>Wanneer hoor ik iets?</summary>
        <p>We behandelen claims meestal binnen 2 werkdagen. Je kunt de voortgang altijd volgen via "Status bekijken".</p>
      </details>
    </section>`;
}

// ---------- Claimformulier (wizard) ----------

const STEPS = ['Bestelling', 'Details', 'Controleren'];

function newWizard(type) {
  return {
    type,
    step: 0,
    order: { name: '', email: '', orderNumber: '', orderDate: '' },
    details: {
      items: [{ product: '', quantity: 1 }],
      photos: [],
      reason: '',
      resolution: '',
      receivedDate: '',
      explanation: '',
      product: '',
      variant: '',
      description: '',
      issue: '',
      carrier: '',
      tracking: '',
      address: '',
      checkedNeighbours: false,
    },
    consent: false,
    errors: {},
    submitted: null,
  };
}

function itemsEditor(items, error) {
  const rows = items
    .map(
      (item, i) => `
      <div class="item-row">
        <div class="item-product">
          <label class="sr-only" for="details.items.${i}.product">Artikel ${i + 1}</label>
          ${input(`details.items.${i}.product`, item.product, { placeholder: 'Bijv. Wool overshirt – maat M' })}
        </div>
        <div class="item-qty">
          <label class="sr-only" for="details.items.${i}.quantity">Aantal</label>
          ${input(`details.items.${i}.quantity`, item.quantity, { type: 'number', min: 1, max: 99, inputmode: 'numeric' })}
        </div>
        ${
          items.length > 1
            ? `<button type="button" class="icon-button" data-action="remove-item" data-index="${i}" aria-label="Artikel ${i + 1} verwijderen">×</button>`
            : ''
        }
      </div>`,
    )
    .join('');
  return `
    <div class="field ${error ? 'has-error' : ''}" data-field="details.items">
      <span class="label" id="items-label">Om welke artikelen gaat het?</span>
      <p class="hint">Vul per artikel de naam, maat en het aantal in.</p>
      <div class="items" role="group" aria-labelledby="items-label">${rows}</div>
      <button type="button" class="link-button" data-action="add-item">+ Nog een artikel</button>
      ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
    </div>`;
}

function photosEditor(photos, error) {
  const previews = photos
    .map(
      (src, i) => `
      <figure class="photo">
        <img src="${esc(src)}" alt="Foto ${i + 1}">
        <button type="button" class="icon-button" data-action="remove-photo" data-index="${i}" aria-label="Foto ${i + 1} verwijderen">×</button>
      </figure>`,
    )
    .join('');
  return `
    <div class="field ${error ? 'has-error' : ''}" data-field="details.photos">
      <span class="label">Foto's van het gebrek</span>
      <p class="hint">Maximaal ${MAX_PHOTOS} foto's. Laat het gebrek en het label met de productcode zien.</p>
      <div class="photos">${previews}</div>
      ${
        photos.length < MAX_PHOTOS
          ? `<label class="upload">
              <input type="file" accept="image/*" multiple data-action="add-photos" id="details.photos">
              <span>Foto's toevoegen</span>
            </label>`
          : ''
      }
      ${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}
    </div>`;
}

function renderOrderStep(w) {
  const { order, errors } = w;
  return `
    <h2>Je bestelling</h2>
    <p class="muted">Deze gegevens vind je in je orderbevestiging per e-mail.</p>
    <div class="field-row">
      ${field({ label: 'Naam', name: 'order.name', error: errors.name, control: input('order.name', order.name, { error: errors.name, autocomplete: 'name' }) })}
      ${field({ label: 'E-mailadres', name: 'order.email', error: errors.email, control: input('order.email', order.email, { type: 'email', error: errors.email, autocomplete: 'email' }) })}
    </div>
    <div class="field-row">
      ${field({ label: 'Ordernummer', name: 'order.orderNumber', error: errors.orderNumber, control: input('order.orderNumber', order.orderNumber, { error: errors.orderNumber, placeholder: 'Bijv. 100234' }) })}
      ${field({ label: 'Besteldatum', name: 'order.orderDate', error: errors.orderDate, control: input('order.orderDate', order.orderDate, { type: 'date', error: errors.orderDate, max: todayISO() }) })}
    </div>`;
}

function renderDetailsStep(w) {
  const { type, details: d, errors: e } = w;
  if (type === 'retour') {
    return `
      <h2>Wat wil je retourneren?</h2>
      ${itemsEditor(d.items, e.items)}
      ${field({ label: 'Wanneer heb je de bestelling ontvangen?', name: 'details.receivedDate', error: e.receivedDate, hint: `Je kunt tot ${RETURN_WINDOW_DAYS} dagen na ontvangst retourneren.`, control: input('details.receivedDate', d.receivedDate, { type: 'date', error: e.receivedDate, hint: true, max: todayISO() }) })}
      ${field({ label: 'Reden van retour', name: 'details.reason', error: e.reason, control: select('details.reason', RETURN_REASONS, d.reason, { error: e.reason, rerender: true }) })}
      ${field({ label: 'Toelichting', name: 'details.explanation', error: e.explanation, optional: d.reason !== 'anders', control: textarea('details.explanation', d.explanation, { error: e.explanation, rows: 3 }) })}
      ${field({ label: 'Wat wil je in plaats daarvan?', name: 'details.resolution', error: e.resolution, control: choiceCards('details.resolution', RETURN_RESOLUTIONS, d.resolution, { error: e.resolution }) })}`;
  }
  if (type === 'garantie') {
    return `
      <h2>Wat is er mis met je product?</h2>
      <div class="field-row">
        ${field({ label: 'Product', name: 'details.product', error: e.product, control: input('details.product', d.product, { error: e.product, placeholder: 'Bijv. Canvas tote bag' }) })}
        ${field({ label: 'Maat / kleur', name: 'details.variant', optional: true, control: input('details.variant', d.variant, { placeholder: 'Bijv. One size, zwart' }) })}
      </div>
      ${field({ label: 'Omschrijving van het probleem', name: 'details.description', error: e.description, hint: 'Wanneer ontstond het, hoe vaak heb je het product gebruikt en hoe heb je het gewassen?', control: textarea('details.description', d.description, { error: e.description, hint: true, rows: 5 }) })}
      ${photosEditor(d.photos, e.photos)}
      ${field({ label: 'Wat is je voorkeursoplossing?', name: 'details.resolution', error: e.resolution, control: choiceCards('details.resolution', WARRANTY_RESOLUTIONS, d.resolution, { error: e.resolution }) })}`;
  }
  return `
    <h2>Wat is er met je pakket aan de hand?</h2>
    ${field({ label: 'Wat is het probleem?', name: 'details.issue', error: e.issue, control: choiceCards('details.issue', DELIVERY_ISSUES, d.issue, { error: e.issue }) })}
    ${d.issue === 'onvolledig' ? itemsEditor(d.items, e.items) : ''}
    <div class="field-row">
      ${field({ label: 'Vervoerder', name: 'details.carrier', error: e.carrier, control: select('details.carrier', CARRIERS, d.carrier, { error: e.carrier }) })}
      ${field({ label: 'Track & trace-code', name: 'details.tracking', optional: true, control: input('details.tracking', d.tracking, { placeholder: 'Bijv. 3SABCD1234567' }) })}
    </div>
    ${field({ label: 'Bezorgadres', name: 'details.address', error: e.address, hint: 'Controleer of dit hetzelfde adres is als in je bestelling.', control: textarea('details.address', d.address, { error: e.address, hint: true, rows: 3 }) })}
    ${
      d.issue === 'bezorgd_niet_ontvangen'
        ? `<div class="field ${e.checkedNeighbours ? 'has-error' : ''}" data-field="details.checkedNeighbours">
            <label class="checkbox">
              <input type="checkbox" id="details.checkedNeighbours" data-bind="details.checkedNeighbours" ${d.checkedNeighbours ? 'checked' : ''}>
              <span>Ik heb bij de buren, mijn brievenbus en het afhaalpunt gecheckt.</span>
            </label>
            ${e.checkedNeighbours ? `<p class="error" role="alert">${esc(e.checkedNeighbours)}</p>` : ''}
          </div>`
        : ''
    }
    ${field({ label: 'Toelichting', name: 'details.explanation', optional: true, control: textarea('details.explanation', d.explanation, { rows: 3 }) })}`;
}

function renderReviewStep(w) {
  const warnings = checkEligibility(w.type, w.details, w.order, today());
  return `
    <h2>Klopt alles?</h2>
    <p class="muted">Controleer je gegevens. Na het versturen ontvang je een claimnummer.</p>
    ${warningsBox(warnings)}
    ${summary(w.type, w.order, w.details)}
    <label class="checkbox consent">
      <input type="checkbox" id="consent" data-bind="consent" ${w.consent ? 'checked' : ''}>
      <span>Ik verklaar dat de gegevens naar waarheid zijn ingevuld.</span>
    </label>
    ${w.errors.consent ? `<p class="error" role="alert">${esc(w.errors.consent)}</p>` : ''}`;
}

function renderConfirmation(claim) {
  return `
    <section class="card confirmation">
      <div class="check" aria-hidden="true">✓</div>
      <h1>Bedankt, je claim is ingediend</h1>
      <p>Je claimnummer is</p>
      <p class="claim-number">${esc(claim.number)}</p>
      <p class="muted">Bewaar dit nummer goed. We nemen binnen 2 werkdagen contact met je op via <strong>${esc(claim.order.email)}</strong>.</p>
      ${warningsBox(claim.warnings)}
      <div class="actions center">
        <a class="button" href="#/status?nr=${encodeURIComponent(claim.number)}">Status bekijken</a>
        <a class="button button-secondary" href="#/">Terug naar start</a>
      </div>
    </section>`;
}

function renderWizard(type) {
  if (!CLAIM_TYPES[type]) return renderNotFound();
  if (!state.wizard || state.wizard.type !== type) state.wizard = newWizard(type);
  const w = state.wizard;
  if (w.submitted) return renderConfirmation(w.submitted);

  const steps = STEPS.map(
    (label, i) => `
      <li class="${i === w.step ? 'current' : i < w.step ? 'done' : ''}" ${i === w.step ? 'aria-current="step"' : ''}>
        <span class="step-index">${i < w.step ? '✓' : i + 1}</span><span class="step-label">${label}</span>
      </li>`,
  ).join('');

  const body = [renderOrderStep, renderDetailsStep, renderReviewStep][w.step](w);
  const last = w.step === STEPS.length - 1;

  return `
    <a class="back-link" href="#/">← Alle opties</a>
    <header class="page-head">
      <p class="eyebrow">${esc(CLAIM_TYPES[type].label)}</p>
      <h1>${esc(CLAIM_TYPES[type].title)}</h1>
    </header>
    <ol class="steps">${steps}</ol>
    <form class="card form" novalidate data-form="wizard">
      ${body}
      <div class="actions">
        ${w.step > 0 ? '<button type="button" class="button button-secondary" data-action="prev">Vorige</button>' : '<span></span>'}
        <button type="submit" class="button">${last ? 'Claim versturen' : 'Volgende'}</button>
      </div>
    </form>`;
}

function focusFirstError() {
  const el = app.querySelector('[aria-invalid="true"], .has-error input, .has-error select, .has-error textarea');
  if (el) el.focus();
}

function submitWizardStep() {
  const w = state.wizard;
  let errors = {};
  if (w.step === 0) errors = validateOrder(w.order, today());
  if (w.step === 1) errors = validateDetails(w.type, w.details, w.order, today());
  if (w.step === 2 && !w.consent) errors = { consent: 'Vink dit aan om je claim te versturen.' };
  w.errors = errors;

  if (Object.keys(errors).length) {
    render();
    focusFirstError();
    return;
  }

  if (w.step < STEPS.length - 1) {
    w.step += 1;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  const details = { ...w.details, items: w.details.items.filter((item) => item.product.trim()) };
  const claim = store.add(createClaim({ type: w.type, order: w.order, details }, new Date()));
  w.submitted = claim;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Verkleint foto's zodat ze in de opslag passen.
function resizeImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Kon de afbeelding niet lezen.'));
      img.onload = () => {
        const scale = Math.min(1, PHOTO_MAX_SIZE / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function addPhotos(files) {
  const w = state.wizard;
  const room = MAX_PHOTOS - w.details.photos.length;
  const images = [...files].filter((file) => file.type.startsWith('image/')).slice(0, room);
  try {
    const resized = await Promise.all(images.map(resizeImage));
    w.details.photos.push(...resized);
    delete w.errors.photos;
  } catch {
    w.errors.photos = 'Een van de foto\'s kon niet worden gelezen. Probeer een ander bestand.';
  }
  render();
}

// ---------- Status opzoeken ----------

function renderStatus(params) {
  const l = state.lookup;
  if (params.get('nr') && !l.number) l.number = params.get('nr');

  let result = '';
  if (l.result === null) {
    result = `<div class="notice notice-error" role="alert"><p>We konden geen claim vinden met dit claimnummer en e-mailadres. Controleer je gegevens en probeer het opnieuw.</p></div>`;
  } else if (l.result) {
    const claim = store.get(l.result) ?? null;
    if (claim) {
      result = `
        <section class="card">
          <div class="claim-head">
            <div>
              <p class="eyebrow">${esc(CLAIM_TYPES[claim.type].label)} · ingediend op ${esc(formatDate(claim.createdAt))}</p>
              <h2>${esc(claim.number)}</h2>
            </div>
            ${statusBadge(claim.status)}
          </div>
          <h3>Voortgang</h3>
          ${timeline(claim.history)}
          <details class="claim-details">
            <summary>Ingediende gegevens</summary>
            ${summary(claim.type, claim.order, claim.details)}
          </details>
        </section>`;
    }
  }

  return `
    <header class="page-head">
      <p class="eyebrow">Status</p>
      <h1>Status van je claim</h1>
      <p class="lead">Vul je claimnummer en het e-mailadres in waarmee je de claim hebt ingediend.</p>
    </header>
    <form class="card form" novalidate data-form="lookup">
      <div class="field-row">
        ${field({ label: 'Claimnummer', name: 'lookup.number', control: input('lookup.number', l.number, { placeholder: 'OFS-XXXXXX', required: true, autocapitalize: 'characters' }) })}
        ${field({ label: 'E-mailadres', name: 'lookup.email', control: input('lookup.email', l.email, { type: 'email', required: true, autocomplete: 'email' }) })}
      </div>
      <div class="actions"><span></span><button type="submit" class="button">Zoeken</button></div>
    </form>
    ${result}`;
}

// ---------- Beheer ----------

function renderAdmin() {
  const a = state.admin;
  const query = a.query.trim().toLowerCase();
  const all = store.list();
  const claims = all.filter(
    (c) =>
      (!a.type || c.type === a.type) &&
      (!a.status || c.status === a.status) &&
      (!query ||
        [c.number, c.order.name, c.order.email, c.order.orderNumber].some((v) => v.toLowerCase().includes(query))),
  );

  const counts = Object.keys(STATUSES).map((status) => ({
    status,
    count: all.filter((c) => c.status === status).length,
  }));

  const rows = claims.length
    ? claims
        .map((c) => {
          const open = a.open === c.number;
          return `
          <li class="claim-row ${open ? 'open' : ''}">
            <button type="button" class="claim-row-head" data-action="toggle-claim" data-number="${esc(c.number)}" aria-expanded="${open}">
              <span class="mono">${esc(c.number)}</span>
              <span>${esc(CLAIM_TYPES[c.type].label)}</span>
              <span class="truncate">${esc(c.order.name)} · #${esc(c.order.orderNumber)}</span>
              <span class="muted">${esc(formatDate(c.createdAt))}</span>
              ${statusBadge(c.status)}
            </button>
            ${
              open
                ? `<div class="claim-row-body">
                    ${warningsBox(c.warnings)}
                    <div class="admin-grid">
                      <div>${summary(c.type, c.order, c.details)}</div>
                      <div>
                        <form class="admin-update" data-form="admin-update" data-number="${esc(c.number)}">
                          <h3>Status bijwerken</h3>
                          ${field({ label: 'Nieuwe status', name: 'admin-status', control: select('admin-status', STATUSES, c.status, { placeholder: 'Kies status', bind: false }) })}
                          ${field({ label: 'Bericht aan klant', name: 'admin-note', optional: true, control: '<textarea id="admin-note" name="admin-note" rows="3"></textarea>' })}
                          <button type="submit" class="button">Opslaan</button>
                        </form>
                        <h3>Historie</h3>
                        ${timeline(c.history)}
                      </div>
                    </div>
                  </div>`
                : ''
            }
          </li>`;
        })
        .join('')
    : `<li class="empty">${all.length ? 'Geen claims gevonden met deze filters.' : 'Er zijn nog geen claims ingediend.'}</li>`;

  return `
    <header class="page-head">
      <p class="eyebrow">Beheer</p>
      <h1>Claims</h1>
      <p class="muted">Demo-omgeving: in productie hoort deze pagina achter een login.</p>
    </header>
    ${a.message ? `<div class="notice notice-success" role="status"><p>${esc(a.message)}</p></div>` : ''}
    <section class="stats" aria-label="Aantal claims per status">
      ${counts.map(({ status, count }) => `<div class="stat"><span class="stat-value">${count}</span><span class="stat-label">${esc(STATUSES[status])}</span></div>`).join('')}
    </section>
    <form class="filters" data-form="admin-filters" role="search">
      <label class="sr-only" for="admin.query">Zoeken</label>
      ${input('admin.query', a.query, { type: 'search', placeholder: 'Zoek op claim, naam, e-mail of order' })}
      <label class="sr-only" for="admin.type">Type</label>
      ${select('admin.type', Object.fromEntries(Object.entries(CLAIM_TYPES).map(([k, v]) => [k, v.label])), a.type, { placeholder: 'Alle types', rerender: true })}
      <label class="sr-only" for="admin.status">Status</label>
      ${select('admin.status', STATUSES, a.status, { placeholder: 'Alle statussen', rerender: true })}
    </form>
    <ul class="claim-list">${rows}</ul>`;
}

function renderNotFound() {
  return `
    <section class="card confirmation">
      <h1>Pagina niet gevonden</h1>
      <p><a href="#/">Terug naar de startpagina</a></p>
    </section>`;
}

// ---------- Router en events ----------

function parseRoute() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const [path, queryString = ''] = hash.split('?');
  return { parts: path.split('/').filter(Boolean), params: new URLSearchParams(queryString) };
}

function render() {
  const { parts, params } = parseRoute();
  let html;
  let page = parts[0] ?? 'home';
  if (parts.length === 0) html = renderHome();
  else if (parts[0] === 'claim') html = renderWizard(parts[1]);
  else if (parts[0] === 'status') html = renderStatus(params);
  else if (parts[0] === 'beheer') html = renderAdmin();
  else {
    html = renderNotFound();
    page = 'notfound';
  }
  app.innerHTML = html;
  for (const link of document.querySelectorAll('.nav a')) {
    link.toggleAttribute('aria-current', link.dataset.page === page);
  }
}

function bindTarget(path) {
  if (path.startsWith('order.') || path.startsWith('details.') || path === 'consent') return state.wizard;
  return state;
}

// Haalt de foutmelding weg zodra de klant het veld aanpast, zonder opnieuw te renderen.
function clearFieldError(el, path) {
  const errors = state.wizard?.errors;
  const key = path === 'consent' ? 'consent' : path.split('.')[1];
  if (!errors || !(key in errors)) return;
  delete errors[key];
  const wrapper = path === 'consent' ? el.closest('.form') : el.closest('[data-field]');
  if (!wrapper) return;
  wrapper.classList.remove('has-error');
  wrapper.querySelectorAll('[aria-invalid]').forEach((node) => node.removeAttribute('aria-invalid'));
  wrapper.querySelectorAll(path === 'consent' ? ':scope > .error' : '.error').forEach((node) => node.remove());
}

app.addEventListener('input', (event) => {
  const el = event.target;
  const path = el.dataset.bind;
  if (!path || el.type === 'radio' || el.type === 'checkbox' || el.tagName === 'SELECT') return;
  const value = el.type === 'number' ? (el.value === '' ? '' : Number(el.value)) : el.value;
  setPath(bindTarget(path), path, value);
  clearFieldError(el, path);
  if (path === 'admin.query') {
    const caret = el.selectionStart;
    render();
    const search = document.getElementById('admin.query');
    search.focus();
    search.setSelectionRange(caret, caret);
  }
});

app.addEventListener('change', (event) => {
  const el = event.target;
  if (el.dataset.action === 'add-photos') {
    addPhotos(el.files);
    return;
  }
  const path = el.dataset.bind;
  if (!path) return;
  if (el.type === 'checkbox') setPath(bindTarget(path), path, el.checked);
  else if (el.type === 'radio' || el.tagName === 'SELECT') setPath(bindTarget(path), path, el.value);
  else return;
  clearFieldError(el, path);

  // Velden die andere velden tonen/verbergen vragen om een nieuwe render.
  if (el.hasAttribute('data-rerender') || path === 'details.issue') {
    render();
    document.getElementById(path)?.focus();
  }
});

app.addEventListener('click', (event) => {
  const button = event.target.closest('[data-action]');
  if (!button || button.tagName === 'INPUT') return;
  const w = state.wizard;
  switch (button.dataset.action) {
    case 'prev':
      w.step -= 1;
      w.errors = {};
      render();
      break;
    case 'add-item':
      w.details.items.push({ product: '', quantity: 1 });
      render();
      document.getElementById(`details.items.${w.details.items.length - 1}.product`)?.focus();
      break;
    case 'remove-item':
      w.details.items.splice(Number(button.dataset.index), 1);
      render();
      break;
    case 'remove-photo':
      w.details.photos.splice(Number(button.dataset.index), 1);
      render();
      break;
    case 'toggle-claim':
      state.admin.open = state.admin.open === button.dataset.number ? null : button.dataset.number;
      state.admin.message = '';
      render();
      break;
    default:
  }
});

app.addEventListener('submit', (event) => {
  event.preventDefault();
  const form = event.target;
  const kind = form.dataset.form;
  if (kind === 'wizard') submitWizardStep();
  if (kind === 'lookup') {
    const claim = store.findForCustomer(state.lookup.number, state.lookup.email);
    state.lookup.result = claim ? claim.number : null;
    render();
  }
  if (kind === 'admin-update') {
    const claim = store.get(form.dataset.number);
    const status = form.elements['admin-status'].value;
    const note = form.elements['admin-note'].value;
    if (!claim || !status) return;
    store.save(updateClaimStatus(claim, status, note, new Date()));
    state.admin.message = `Claim ${claim.number} is bijgewerkt naar "${STATUSES[status]}".`;
    render();
  }
});

window.addEventListener('hashchange', () => {
  const { parts } = parseRoute();
  // Een afgeronde claim niet opnieuw tonen als de klant later een nieuwe claim start.
  if (state.wizard?.submitted && parts[0] === 'claim') state.wizard = null;
  if (parts[0] !== 'status') state.lookup.result = undefined;
  render();
  window.scrollTo(0, 0);
});

document.getElementById('year').textContent = new Date().getFullYear();
render();

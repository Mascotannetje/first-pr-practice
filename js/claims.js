// Domeinlogica voor claims: types, statussen, validatie en termijnen.
// Bevat geen DOM-code, zodat alles ook in Node getest kan worden.

export const RETURN_WINDOW_DAYS = 30;
export const WARRANTY_MONTHS = 24;
export const DELIVERY_GRACE_DAYS = 5;

export const CLAIM_TYPES = {
  retour: {
    label: 'Retour',
    title: 'Artikel retourneren',
    description: 'Past het niet of valt het tegen? Stuur je bestelling binnen 30 dagen terug.',
  },
  garantie: {
    label: 'Garantie',
    title: 'Garantieclaim indienen',
    description: 'Is je product kapot gegaan of vertoont het een gebrek? Meld het hier.',
  },
  'niet-geleverd': {
    label: 'Niet geleverd',
    title: 'Pakket niet ontvangen',
    description: 'Is je bestelling niet aangekomen of staat de tracking stil? Laat het ons weten.',
  },
};

export const STATUSES = {
  ontvangen: 'Ontvangen',
  in_behandeling: 'In behandeling',
  wacht_op_klant: 'Wacht op jouw reactie',
  goedgekeurd: 'Goedgekeurd',
  afgewezen: 'Afgewezen',
  afgerond: 'Afgerond',
};

export const RETURN_REASONS = {
  te_groot: 'Te groot',
  te_klein: 'Te klein',
  niet_verwacht: 'Niet zoals verwacht',
  verkeerd_artikel: 'Verkeerd artikel ontvangen',
  beschadigd: 'Beschadigd ontvangen',
  anders: 'Anders',
};

export const RETURN_RESOLUTIONS = {
  terugbetaling: 'Geld terug',
  ruilen: 'Ruilen voor een andere maat/kleur',
  tegoed: 'Tegoedbon',
};

export const WARRANTY_RESOLUTIONS = {
  reparatie: 'Reparatie',
  vervanging: 'Vervanging',
  terugbetaling: 'Geld terug',
};

export const CARRIERS = {
  postnl: 'PostNL',
  dhl: 'DHL',
  dpd: 'DPD',
  ups: 'UPS',
  anders: 'Anders / weet ik niet',
};

export const DELIVERY_ISSUES = {
  niets_ontvangen: 'Ik heb niets ontvangen',
  bezorgd_niet_ontvangen: 'Tracking zegt bezorgd, maar ik heb het niet',
  tracking_staat_stil: 'De tracking staat al dagen stil',
  onvolledig: 'Pakket kwam onvolledig aan',
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function isBlank(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function parseDate(value) {
  if (isBlank(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDayUTC(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

export function daysBetween(from, to) {
  return Math.round((startOfDayUTC(to) - startOfDayUTC(from)) / DAY_MS);
}

export function addMonths(date, months) {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

export function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}

export function normalizeClaimNumber(number) {
  return String(number ?? '').trim().toUpperCase();
}

export function generateClaimNumber(random = Math.random) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[Math.floor(random() * alphabet.length)];
  }
  return `OFS-${code}`;
}

export function validateOrder(order, today = new Date()) {
  const errors = {};
  if (isBlank(order.name)) errors.name = 'Vul je naam in.';
  if (isBlank(order.email)) errors.email = 'Vul je e-mailadres in.';
  else if (!EMAIL_RE.test(String(order.email).trim())) errors.email = 'Dit e-mailadres lijkt niet te kloppen.';
  if (isBlank(order.orderNumber)) errors.orderNumber = 'Vul je ordernummer in.';
  else if (!/^[A-Za-z0-9-]{4,20}$/.test(String(order.orderNumber).trim())) {
    errors.orderNumber = 'Een ordernummer bestaat uit 4 tot 20 letters, cijfers of streepjes.';
  }
  const orderDate = parseDate(order.orderDate);
  if (!orderDate) errors.orderDate = 'Kies je besteldatum.';
  else if (daysBetween(orderDate, today) < 0) errors.orderDate = 'De besteldatum kan niet in de toekomst liggen.';
  return errors;
}

function validateItems(items, errors) {
  const filled = (items ?? []).filter((item) => !isBlank(item.product));
  if (filled.length === 0) {
    errors.items = 'Voeg minimaal één artikel toe.';
    return;
  }
  for (const item of filled) {
    const quantity = Number(item.quantity);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      errors.items = 'Het aantal per artikel moet tussen 1 en 99 liggen.';
      return;
    }
  }
}

export function validateDetails(type, details, order, today = new Date()) {
  const errors = {};
  const orderDate = parseDate(order?.orderDate);

  if (type === 'retour') {
    validateItems(details.items, errors);
    if (!RETURN_REASONS[details.reason]) errors.reason = 'Kies een reden.';
    if (details.reason === 'anders' && isBlank(details.explanation)) {
      errors.explanation = 'Vertel ons kort waarom je retourneert.';
    }
    if (!RETURN_RESOLUTIONS[details.resolution]) errors.resolution = 'Kies wat je terug wilt.';
    const received = parseDate(details.receivedDate);
    if (!received) errors.receivedDate = 'Kies de datum waarop je de bestelling ontving.';
    else if (daysBetween(received, today) < 0) errors.receivedDate = 'Deze datum ligt in de toekomst.';
    else if (orderDate && daysBetween(orderDate, received) < 0) {
      errors.receivedDate = 'Je kunt de bestelling niet vóór de besteldatum ontvangen hebben.';
    }
  } else if (type === 'garantie') {
    if (isBlank(details.product)) errors.product = 'Welk product betreft het?';
    if (isBlank(details.description) || String(details.description).trim().length < 20) {
      errors.description = 'Beschrijf het probleem in minimaal 20 tekens.';
    }
    if (!WARRANTY_RESOLUTIONS[details.resolution]) errors.resolution = 'Kies je voorkeursoplossing.';
    if (!Array.isArray(details.photos) || details.photos.length === 0) {
      errors.photos = 'Voeg minimaal één foto van het gebrek toe.';
    }
  } else if (type === 'niet-geleverd') {
    if (!DELIVERY_ISSUES[details.issue]) errors.issue = 'Kies wat er aan de hand is.';
    if (!CARRIERS[details.carrier]) errors.carrier = 'Kies de vervoerder.';
    if (isBlank(details.address)) errors.address = 'Vul het bezorgadres in.';
    if (details.issue === 'bezorgd_niet_ontvangen' && !details.checkedNeighbours) {
      errors.checkedNeighbours = 'Check eerst even bij de buren en je brievenbus/afhaalpunt.';
    }
    if (details.issue === 'onvolledig') validateItems(details.items, errors);
  } else {
    errors.type = 'Onbekend claimtype.';
  }
  return errors;
}

// Geeft niet-blokkerende waarschuwingen terug, bijvoorbeeld als een termijn verstreken lijkt.
// De klant kan de claim dan nog steeds indienen; de webshop beoordeelt het definitief.
export function checkEligibility(type, details, order, today = new Date()) {
  const warnings = [];
  if (type === 'retour') {
    const received = parseDate(details.receivedDate);
    if (received) {
      const days = daysBetween(received, today);
      if (days > RETURN_WINDOW_DAYS) {
        warnings.push(
          `Je hebt de bestelling ${days} dagen geleden ontvangen. De retourtermijn is ${RETURN_WINDOW_DAYS} dagen, ` +
            'dus we kunnen je retour mogelijk niet accepteren.',
        );
      }
    }
  } else if (type === 'garantie') {
    const orderDate = parseDate(order?.orderDate);
    if (orderDate && addMonths(orderDate, WARRANTY_MONTHS) < today) {
      warnings.push(
        `Je aankoop is ouder dan ${WARRANTY_MONTHS} maanden. Je kunt je claim indienen, ` +
          'maar we beoordelen per geval of het gebrek nog onder de garantie valt.',
      );
    }
  } else if (type === 'niet-geleverd') {
    const orderDate = parseDate(order?.orderDate);
    if (orderDate && details.issue === 'niets_ontvangen') {
      const days = daysBetween(orderDate, today);
      if (days < DELIVERY_GRACE_DAYS) {
        warnings.push(
          `Je hebt ${days === 0 ? 'vandaag' : `${days} dag${days === 1 ? '' : 'en'} geleden`} besteld. ` +
            `Bezorging duurt soms tot ${DELIVERY_GRACE_DAYS} werkdagen; je kunt alvast een melding maken.`,
        );
      }
    }
  }
  return warnings;
}

export function createClaim({ type, order, details }, now = new Date(), random = Math.random) {
  const timestamp = now.toISOString();
  return {
    number: generateClaimNumber(random),
    type,
    status: 'ontvangen',
    createdAt: timestamp,
    updatedAt: timestamp,
    order: {
      name: String(order.name).trim(),
      email: normalizeEmail(order.email),
      orderNumber: String(order.orderNumber).trim().toUpperCase(),
      orderDate: order.orderDate,
    },
    details,
    warnings: checkEligibility(type, details, order, now),
    history: [{ status: 'ontvangen', at: timestamp, note: 'Je claim is ontvangen.' }],
  };
}

export function updateClaimStatus(claim, status, note = '', now = new Date()) {
  if (!STATUSES[status]) throw new Error(`Onbekende status: ${status}`);
  const timestamp = now.toISOString();
  return {
    ...claim,
    status,
    updatedAt: timestamp,
    history: [...claim.history, { status, at: timestamp, note: String(note).trim() }],
  };
}

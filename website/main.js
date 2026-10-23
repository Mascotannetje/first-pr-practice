// Interactie voor de Resolvd-landingspagina. Geen libraries nodig.
const CONTACT_EMAIL = 'hallo@resolvd.nl'; // pas aan naar het echte adres

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- navigatie ----------
const nav = document.getElementById('nav');
const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 20);
window.addEventListener('scroll', onScroll, { passive: true });
onScroll();

// ---------- tellers ----------
function countUp(el) {
  const target = Number(el.dataset.count);
  const prefix = el.dataset.prefix ?? '';
  const suffix = el.dataset.suffix ?? '';
  if (reduceMotion) { el.textContent = `${prefix}${target}${suffix}`; return; }
  const start = performance.now();
  const duration = 1400;
  const step = (now) => {
    const k = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - k, 3);
    el.textContent = `${prefix}${Math.round(target * eased)}${suffix}`;
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------- onthullen bij scrollen ----------
const revealObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    entry.target.classList.add('in');
    entry.target.querySelectorAll('[data-count]').forEach(countUp);
    if (entry.target.matches('[data-count]')) countUp(entry.target);
    revealObserver.unobserve(entry.target);
  }
}, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
document.querySelectorAll('.reveal, .report').forEach((el) => revealObserver.observe(el));
requestAnimationFrame(() => document.querySelector('.hero-title').classList.add('in'));

// ---------- chatgesprekken ----------
const CONVERSATIONS = [
  [['sys', 'Gemiste oproep van Mevr. Jansen'], ['bot', 'Hoi! Mark staat op een klus. Waarmee kunnen we je helpen?'], ['me', 'Mijn cv-ketel lekt.'],
   ['bot', 'Vervelend! Kan Mark morgen om 8:00 of 13:00 langskomen?'], ['me', '8:00 graag!'], ['ok', '✓ Ingepland in de agenda']],
  [['card', '<b>Nieuwe aanvraag via de website</b><small>Warmtepomp laten plaatsen</small>'], ['bot', 'Bedankt voor je aanvraag! Wanneer past een adviesgesprek?'],
   ['ok', '✓ Binnen een minuut beantwoord'], ['me', 'Donderdagmiddag graag.']],
  [['card', '<b>Offerte warmtepomp</b><small>Nog geen reactie</small>'], ['bot', 'Hoi! Heb je nog vragen over de offerte? Mark belt je graag even.'],
   ['me', 'Ziet er goed uit, akkoord!'], ['ok', '✓ Offerte getekend']],
  [['card', '<b>Klus afgerond</b><small>Cv-ketel gerepareerd</small>'], ['bot', 'Bedankt voor je vertrouwen! Wil je een review achterlaten?'],
   ['stars', '★★★★★'], ['ok', '★ Nieuwe Google-review']],
];

function messageEl([kind, html]) {
  const el = document.createElement('div');
  el.className = `msg ${kind}`;
  el.innerHTML = html;
  return el;
}

// Speelt een gesprek bericht voor bericht af; geeft een functie terug om te stoppen.
function playConversation(container, messages, { gap = 1100, onDone } = {}) {
  container.replaceChildren();
  if (reduceMotion) {
    messages.forEach((m) => container.append(messageEl(m)));
    return () => {};
  }
  let i = 0;
  let timer;
  const next = () => {
    if (i >= messages.length) { if (onDone) timer = setTimeout(onDone, 2600); return; }
    container.append(messageEl(messages[i++]));
    timer = setTimeout(next, gap);
  };
  timer = setTimeout(next, 400);
  return () => clearTimeout(timer);
}

// hero: alle vier de momenten na elkaar, in een lus
const heroChat = document.getElementById('heroChat');
let heroIndex = 0;
const playHero = () => playConversation(heroChat, CONVERSATIONS[heroIndex], {
  onDone: () => { heroIndex = (heroIndex + 1) % CONVERSATIONS.length; playHero(); },
});
playHero();

// "Hoe het werkt": de telefoon volgt de stap die in beeld is
const howChat = document.getElementById('howChat');
const steps = [...document.querySelectorAll('.how-step')];
let activeStep = -1;
let stopHow = () => {};
const stepObserver = new IntersectionObserver((entries) => {
  const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
  if (!visible) return;
  const index = Number(visible.target.dataset.step);
  if (index === activeStep) return;
  activeStep = index;
  steps.forEach((s, i) => s.classList.toggle('active', i === index));
  stopHow();
  stopHow = playConversation(howChat, CONVERSATIONS[index], { gap: 800 });
}, { threshold: [0.5, 0.75], rootMargin: '-20% 0px -20% 0px' });
steps.forEach((s) => stepObserver.observe(s));

// ---------- pilotformulier ----------
const form = document.getElementById('pilotForm');
const formError = document.getElementById('formError');
form.addEventListener('submit', (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form));
  const missing = ['naam', 'bedrijf', 'contact'].filter((k) => !String(data[k] ?? '').trim());
  form.querySelectorAll('input').forEach((input) => input.toggleAttribute('aria-invalid', missing.includes(input.name)));
  formError.hidden = missing.length === 0;
  if (missing.length) { form.querySelector(`[name="${missing[0]}"]`).focus(); return; }
  const body = `Naam: ${data.naam}\nBedrijf: ${data.bedrijf}\nContact: ${data.contact}\nAantal medewerkers: ${data.team}\n\nIk wil meedoen met de gratis pilot.`;
  window.location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('Aanmelding pilot Resolvd')}&body=${encodeURIComponent(body)}`;
});

document.getElementById('year').textContent = new Date().getFullYear();

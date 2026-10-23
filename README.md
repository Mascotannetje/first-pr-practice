# Offseason serviceportaal

Een serviceportaal waar klanten van de Offseason-webshop zelf een claim indienen voor:

- **Retour**: artikelen terugsturen (reden, gewenste oplossing, ontvangstdatum).
- **Garantie**: een defect product melden, met foto's en voorkeursoplossing.
- **Niet geleverd**: pakket niet ontvangen, bezorgd maar niet aangekomen, tracking staat stil of onvolledig geleverd.

Na het indienen krijgt de klant een claimnummer (`OFS-XXXXXX`). Daarmee en met het e-mailadres kan de klant de status en de voortgang volgen. Op de beheerpagina (`#/beheer`) ziet de webshop alle claims, kan filteren en zoeken, en zet de status op bijvoorbeeld *In behandeling* of *Goedgekeurd*, met een bericht aan de klant.

## Starten

Je hebt alleen Node.js 20 of nieuwer nodig, er zijn geen dependencies.

```bash
npm start      # http://localhost:8080
npm test       # unit tests voor validatie, termijnen en opslag
```

## Structuur

| Bestand | Inhoud |
| --- | --- |
| `index.html` | Pagina-opbouw (header, footer) |
| `css/styles.css` | Styling, inclusief donkere modus en mobiel |
| `js/claims.js` | Domeinlogica: claimtypes, statussen, validatie, termijnen |
| `js/store.js` | Opslag van claims (nu `localStorage`) |
| `js/app.js` | Schermen, formulierstappen en routing |
| `test/` | Tests met de ingebouwde `node:test` |

## Aanpassen

De termijnen staan bovenaan `js/claims.js`:

- `RETURN_WINDOW_DAYS`: retourtermijn (standaard 30 dagen)
- `WARRANTY_MONTHS`: garantietermijn (standaard 24 maanden)
- `DELIVERY_GRACE_DAYS`: na hoeveel dagen een pakket als laat geldt (standaard 5)

Buiten een termijn wordt een claim niet geblokkeerd. De klant ziet een waarschuwing en de webshop beslist.

## Op weg naar productie

Dit is een werkend prototype. Wat er nog nodig is voor echt gebruik:

1. **Backend en database.** Claims staan nu in de browser van de gebruiker. Vervang `js/store.js` door API-calls.
2. **Login voor beheer.** `#/beheer` is nu voor iedereen open.
3. **Ordercontrole.** Koppeling met de webshop (bijv. Shopify of WooCommerce) om te controleren of ordernummer en e-mailadres bij elkaar horen.
4. **E-mailnotificaties** bij een nieuwe claim en bij elke statuswijziging.
5. **Retourlabels** automatisch aanmaken via de vervoerder.

## Resolvd-landingspagina

In `website/` staat de landingspagina voor Resolvd (resolvd.nl): "De AI-binnendienst voor installateurs". Het is gewone HTML, CSS en JavaScript zonder build-stap.

```bash
npm start      # daarna http://localhost:8080/website/
```

Aanpassen:
- Teksten staan in `website/index.html`, kleuren en lettertypes bovenaan `website/styles.css`.
- Het pilotformulier opent het e-mailprogramma van de bezoeker. Zet het juiste adres in `CONTACT_EMAIL` bovenaan `website/main.js`.
- De chatgesprekken in de telefoon staan in `CONVERSATIONS` in `website/main.js`.

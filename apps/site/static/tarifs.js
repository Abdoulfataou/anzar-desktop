// Tarifs dans la monnaie du visiteur.
// 1. On devine le pays (fuseau horaire, puis région du navigateur) ; le serveur peut aussi le lire.
// 2. On demande l'offre au backend (mêmes prix que l'app). 3. S'il ne répond pas : grilles
//    embarquées (/assets/prix.json), signalées comme indicatives.
(function () {
  "use strict";

  var API = "https://anzar-api.issalanhub.com/api/public/pricing";
  var CLE = "anzar.devise";
  var el = function (id) { return document.getElementById(id); };
  var noeud = el("textes-tarifs");
  var T = noeud ? JSON.parse(noeud.textContent) : null;
  var depart = el("prix-depart");
  var intl = T ? T.intl : (depart && depart.getAttribute("data-intl")) || "fr-FR";
  if (!T && !depart) return;

  // Fuseaux → pays (pays des monnaies acceptées, et quelques grands pays)
  var FUSEAUX = {
    "Africa/Niamey": "NE", "Africa/Dakar": "SN", "Africa/Abidjan": "CI", "Africa/Bamako": "ML",
    "Africa/Ouagadougou": "BF", "Africa/Lome": "TG", "Africa/Porto-Novo": "BJ", "Africa/Bissau": "GW",
    "Africa/Douala": "CM", "Africa/Libreville": "GA", "Africa/Brazzaville": "CG", "Africa/Bangui": "CF",
    "Africa/Ndjamena": "TD", "Africa/Malabo": "GQ", "Africa/Lagos": "NG", "Africa/Accra": "GH",
    "Africa/Nairobi": "KE", "Africa/Kampala": "UG", "Africa/Dar_es_Salaam": "TZ", "Africa/Kigali": "RW",
    "Africa/Johannesburg": "ZA", "Africa/Casablanca": "MA", "Europe/London": "GB", "Europe/Paris": "FR",
    "Europe/Brussels": "BE", "Europe/Berlin": "DE", "Europe/Madrid": "ES", "Europe/Rome": "IT",
    "Europe/Lisbon": "PT", "Europe/Amsterdam": "NL", "Europe/Dublin": "IE", "America/Toronto": "CA",
    "America/Montreal": "CA", "America/Vancouver": "CA", "America/Edmonton": "CA", "America/Winnipeg": "CA",
    "America/Halifax": "CA", "America/New_York": "US", "America/Chicago": "US", "America/Denver": "US",
    "America/Los_Angeles": "US", "America/Phoenix": "US", "America/Anchorage": "US", "Pacific/Honolulu": "US",
  };

  function paysProbable() {
    try {
      var tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (FUSEAUX[tz]) return FUSEAUX[tz];
    } catch (e) { /* suivant */ }
    var langs = navigator.languages || [navigator.language || ""];
    for (var i = 0; i < langs.length; i++) {
      var m = /^[a-z]{2,3}-([A-Z]{2})$/.exec(langs[i] || "");
      if (m) return m[1];
    }
    return "";
  }

  function lireChoix() { try { return localStorage.getItem(CLE) || ""; } catch (e) { return ""; } }
  function ecrireChoix(c) { try { localStorage.setItem(CLE, c); } catch (e) { /* sans mémoire */ } }
  function oublierChoix() { try { localStorage.removeItem(CLE); } catch (e) { /* sans mémoire */ } }

  function prix(minor, dec, devise) {
    var v = minor / Math.pow(10, dec);
    try {
      return new Intl.NumberFormat(intl, { style: "currency", currency: devise, currencyDisplay: "narrowSymbol",
        minimumFractionDigits: v % 1 === 0 ? 0 : dec, maximumFractionDigits: v % 1 === 0 ? 0 : dec }).format(v);
    } catch (e) { return v + " " + devise; }
  }
  function nombre(n) { try { return new Intl.NumberFormat(intl).format(n); } catch (e) { return String(n); } }
  function nomDevise(code) {
    try { return new Intl.DisplayNames([intl], { type: "currency" }).of(code); } catch (e) { return code; }
  }

  // ── Offre : API, sinon grilles embarquées ──
  var repli = null;
  function chargerRepli() {
    if (repli) return Promise.resolve(repli);
    return fetch("/assets/prix.json").then(function (r) { return r.json(); }).then(function (d) { repli = d; return d; });
  }

  function offreLocale(devise, pays) {
    return chargerRepli().then(function (d) {
      var code = d.grilles[devise] ? devise : d.grilles[d.pays[pays]] ? d.pays[pays] : d.repli;
      var dec = d.decimals[code];
      var xof = code === "XOF";
      var bonus = function (p) {
        var b = 0;
        d.paliers.forEach(function (t) { if (p >= t[0]) b = t[1]; });
        return b;
      };
      return {
        source: "locale", currency: code, decimals: dec, requested_currency: devise || code,
        fallback_reason: devise && devise !== code ? "no_provider" : "",
        packs: d.grilles[code].map(function (g, i) {
          return { label: d.labels[i], price_minor: g[0], credit_fcfa: g[1], bonus_pct: xof ? bonus(g[0]) : 0 };
        }),
        payment_kinds: xof ? ["mobile_money", "card"] : ["card"],
        free_amount: xof, min_fcfa: xof ? d.libre.min : null, max_fcfa: xof ? d.libre.max : null,
        bonus_tiers: xof ? d.paliers : [],
        currencies: Object.keys(d.grilles).sort(),
      };
    });
  }

  function offre(devise, pays) {
    var q = [];
    if (pays) q.push("country=" + encodeURIComponent(pays));
    if (devise) q.push("currency=" + encodeURIComponent(devise));
    var ctrl = window.AbortController ? new AbortController() : null;
    var minuterie = setTimeout(function () { if (ctrl) ctrl.abort(); }, 5000);
    return fetch(API + (q.length ? "?" + q.join("&") : ""), { signal: ctrl ? ctrl.signal : undefined, credentials: "omit" })
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(function (d) {
        clearTimeout(minuterie);
        if (!d.packs || !d.packs.length) throw new Error("vide");
        d.source = "api";
        return d;
      })
      .catch(function () { clearTimeout(minuterie); return offreLocale(devise, pays); });
  }

  // ── Affichage ──
  function rendreAccueil(o) {
    var p = o.packs[0];
    depart.textContent = prix(p.price_minor, o.decimals, o.currency);
  }

  function rendreTarifs(o) {
    var cartes = el("packs").querySelectorAll(".pack");
    o.packs.slice(0, cartes.length).forEach(function (p, i) {
      var c = cartes[i];
      c.querySelector(".pack-prix").textContent = prix(p.price_minor, o.decimals, o.currency);
      c.querySelector(".pack-credits").textContent = nombre(p.credit_fcfa) + " " + T.credits;
      var b = c.querySelector(".pack-bonus");
      if (p.bonus_pct > 0) {
        if (!b) { b = document.createElement("span"); b.className = "pack-bonus"; c.appendChild(b); }
        b.textContent = "+" + p.bonus_pct + " %";
        b.setAttribute("aria-label", "+" + p.bonus_pct + " % " + T.bonus);
      } else if (b) {
        b.remove();
      }
    });
    el("packs").setAttribute("aria-busy", "false");
    el("mention-prix").textContent = o.source === "api" ? T.confirmed : T.indicative;

    // Monnaie demandée non proposée : on dit dans laquelle les prix sont affichés
    var demandee = o.requested_currency || "";
    var repliee = !!o.fallback_reason && demandee && demandee !== o.currency;
    var avis = el("avis-devise");
    avis.hidden = !repliee;
    if (repliee) avis.textContent = T.fallback_currency.replace("{devise}", nomDevise(o.currency));
    if (repliee && lireChoix() === demandee) oublierChoix();   // ne pas redemander une monnaie impossible

    // Monnaies
    var choix = el("devise");
    choix.textContent = "";
    o.currencies.forEach(function (code) {
      var opt = document.createElement("option");
      opt.value = code;
      opt.textContent = nomDevise(code) + " (" + code + ")";
      if (code === o.currency) opt.selected = true;
      choix.appendChild(opt);
    });
    choix.disabled = false;
    // Une seule monnaie payable : pas de sélecteur (il ne servirait qu'à décevoir)
    el("devise").closest(".choix-devise").hidden = o.currencies.length < 2;

    // Moyens de paiement
    var kinds = o.payment_kinds || [];
    if (kinds.length) {
      el("pay-mobile").hidden = kinds.indexOf("mobile_money") < 0;
      el("pay-card").hidden = kinds.indexOf("card") < 0;
    }

    // Montant libre (francs CFA uniquement)
    var libre = el("montant-libre");
    libre.hidden = !o.free_amount;
    if (o.free_amount) {
      var f = function (n) { return prix(n, 0, "XOF"); };
      var paliers = (o.bonus_tiers || []).map(function (t) {
        return T.free_tier.replace("{pct}", t[1]).replace("{montant}", f(t[0]));
      });
      var liste = paliers.length > 1 ? paliers.slice(0, -1).join(", ") + T.free_and + paliers[paliers.length - 1] : paliers.join("");
      el("montant-libre-texte").textContent = T.free_text.replace("{min}", f(o.min_fcfa)).replace("{max}", f(o.max_fcfa))
        .replace("{paliers}", liste);
    }
  }

  var pays = paysProbable();
  function charger(devise) {
    return offre(devise, pays).then(function (o) {
      if (depart) rendreAccueil(o);
      if (T) rendreTarifs(o);
    });
  }

  if (T) {
    el("devise").addEventListener("change", function (e) {
      ecrireChoix(e.target.value);
      el("packs").setAttribute("aria-busy", "true");
      charger(e.target.value);
    });
  }
  charger(lireChoix());
})();

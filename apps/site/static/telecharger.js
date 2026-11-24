// Page de téléchargement : détecte le système, lit la dernière version publiée sur GitHub
// (la même que la mise à jour automatique de l'app) et propose le bon fichier.
(function () {
  "use strict";

  var DEPOT = "Abdoulfataou/anzar-desktop";
  var API = "https://api.github.com/repos/" + DEPOT + "/releases/latest";
  var T = JSON.parse(document.getElementById("textes-telechargement").textContent);
  var el = function (id) { return document.getElementById(id); };
  var remplir = function (modele, valeurs) {
    return modele.replace(/\{(\w+)\}/g, function (_, k) { return valeurs[k] != null ? valeurs[k] : ""; });
  };

  var ua = navigator.userAgent || "";
  var mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  var os = mobile ? null : /Windows/i.test(ua) ? "windows" : /Mac/i.test(ua) ? "mac" : null;
  var puce = "inconnue"; // "arm" | "intel" | "inconnue" (Mac)

  // ── Téléphone : on s'envoie le lien ──
  if (mobile) {
    el("mobile").hidden = false;
    var lien = location.origin + location.pathname;
    var texte = T.mobile_share + " " + lien;
    el("lien-whatsapp").href = "https://wa.me/?text=" + encodeURIComponent(texte);
    el("lien-email").href = "mailto:?subject=" + encodeURIComponent(T.mobile_subject) + "&body=" + encodeURIComponent(texte);
    el("copier").addEventListener("click", function () {
      var b = el("copier");
      if (navigator.clipboard) navigator.clipboard.writeText(lien).then(function () { b.textContent = T.mobile_copied; }, function () {});
    });
  }

  // ── Carte mise en avant ──
  if (os) {
    var carte = el("carte-" + os);
    carte.classList.add("mise-en-avant");
    carte.querySelector(".recommande").hidden = false;
    carte.style.order = "-1";
  }

  // ── Mac : puce Apple ou Intel ? (Chrome/Edge le disent ; sinon WebGL, quand il le dit) ──
  function detecterPuce() {
    if (os !== "mac") return Promise.resolve();
    var uad = navigator.userAgentData;
    if (uad && uad.getHighEntropyValues) {
      return uad.getHighEntropyValues(["architecture"]).then(function (v) {
        puce = v.architecture === "arm" ? "arm" : v.architecture === "x86" ? "intel" : "inconnue";
      }, function () {});
    }
    try {
      var gl = document.createElement("canvas").getContext("webgl");
      var ext = gl && gl.getExtension("WEBGL_debug_renderer_info");
      var rendu = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
      if (/Apple M\d/i.test(rendu)) puce = "arm";
      else if (/Intel|AMD|Radeon/i.test(rendu)) puce = "intel";
    } catch (e) { /* inconnue */ }
    return Promise.resolve();
  }

  var MOTIFS = {
    universel: /universal\.dmg$/i,
    arm: /(aarch64|arm64)\.dmg$/i,
    intel: /(x64|x86_64)\.dmg$/i,
    exe: /setup\.exe$|\.exe$/i,
    msi: /\.msi$/i,
  };

  function taille(o) { return remplir(T.size, { taille: Math.round(o / 1048576) }); }

  function afficher(release) {
    var f = {};
    (release.assets || []).forEach(function (a) {
      Object.keys(MOTIFS).forEach(function (k) { if (!f[k] && MOTIFS[k].test(a.name)) f[k] = a; });
    });
    var numero = String(release.tag_name || "").replace(/^v/i, "");
    var date = "";
    try {
      date = new Intl.DateTimeFormat(T.intl, { day: "numeric", month: "long", year: "numeric" }).format(new Date(release.published_at));
    } catch (e) { /* sans date */ }
    var entete = remplir(T.version, { version: numero, date: date });

    // Mac
    var mac = f.universel || (puce === "intel" ? f.intel : f.arm) || f.arm;
    var vMac = document.querySelector('[data-version="mac"]');
    if (mac) {
      el("bouton-mac").href = mac.browser_download_url;
      vMac.textContent = entete + " · " + taille(mac.size);
    } else {
      vMac.textContent = T.unavailable;
    }
    if (puce === "intel" && !f.universel && !f.intel) el("avis-intel").hidden = false;

    // Windows
    var vWin = document.querySelector('[data-version="windows"]');
    var win = f.exe || f.msi;
    if (win) {
      el("bouton-windows").href = win.browser_download_url;
      vWin.textContent = entete + " · " + taille(win.size);
      if (f.exe && f.msi) {
        var msi = el("lien-msi");
        msi.href = f.msi.browser_download_url;
        msi.hidden = false;
      }
    } else {
      vWin.textContent = T.unavailable;
    }
  }

  function echec() {
    document.querySelectorAll("[data-version]").forEach(function (p) { p.textContent = T.unavailable; });
  }

  detecterPuce().then(function () {
    return fetch(API, { headers: { Accept: "application/vnd.github+json" } });
  }).then(function (r) {
    if (!r.ok) throw new Error(String(r.status));
    return r.json();
  }).then(afficher).catch(echec);
})();

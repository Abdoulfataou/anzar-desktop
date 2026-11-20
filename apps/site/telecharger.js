// Page de téléchargement : détecte le système, lit la dernière version publiée sur GitHub
// (la même que celle de la mise à jour automatique) et propose le bon fichier.
(function () {
  "use strict";

  var DEPOT = "Abdoulfataou/anzar-desktop";
  var PAGE_VERSIONS = "https://github.com/" + DEPOT + "/releases/latest";
  var API = "https://api.github.com/repos/" + DEPOT + "/releases/latest";

  var FICHIERS = [
    { id: "mac-arm", nom: "Mac avec puce Apple (M1, M2, M3…)", motif: /aarch64\.dmg$/i },
    { id: "mac-intel", nom: "Mac avec processeur Intel", motif: /(x64|x86_64)\.dmg$/i },
    { id: "windows", nom: "Windows 10 et 11", motif: /(setup\.exe|\.msi)$/i },
  ];

  var ua = navigator.userAgent || "";
  var estMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1); // iPad récent
  var estWindows = /Windows/i.test(ua);
  var estMac = !estWindows && /Mac/i.test(ua);

  var el = function (id) { return document.getElementById(id); };

  function taille(octets) {
    return (octets / 1048576).toFixed(0).replace(".", ",") + " Mo";
  }

  // ── Téléphone : on s'envoie le lien ──
  if (estMobile) {
    el("principal").classList.add("cache");
    el("mobile").classList.remove("cache");
    var lien = "https://getanzar.com/telecharger/";
    var texte = "Télécharger ANZAR sur mon ordinateur : " + lien;
    el("lien-whatsapp").href = "https://wa.me/?text=" + encodeURIComponent(texte);
    el("lien-email").href = "mailto:?subject=" + encodeURIComponent("Télécharger ANZAR") +
      "&body=" + encodeURIComponent(texte);
    el("copier").addEventListener("click", function () {
      var bouton = el("copier");
      var fini = function () { bouton.textContent = "Lien copié"; };
      if (navigator.clipboard) navigator.clipboard.writeText(lien).then(fini, function () {});
    });
  }

  if (estWindows) {
    el("etapes-mac").classList.add("cache");
    el("etapes-windows").classList.remove("cache");
  }

  function choisirParDefaut(dispo) {
    if (estWindows) return dispo["windows"];
    if (estMac) return dispo["mac-arm"] || dispo["mac-intel"];
    return null;
  }

  function afficher(version) {
    var dispo = {};
    (version.assets || []).forEach(function (a) {
      FICHIERS.forEach(function (f) {
        if (!dispo[f.id] && f.motif.test(a.name)) dispo[f.id] = { url: a.browser_download_url, taille: a.size, nom: f.nom };
      });
    });

    var numero = String(version.tag_name || "").replace(/^v/i, "");
    var choix = choisirParDefaut(dispo);
    var bouton = el("bouton-principal");

    if (choix) {
      bouton.href = choix.url;
      bouton.textContent = "Télécharger pour " + (estWindows ? "Windows" : "Mac");
      el("version").textContent = "Version " + numero + ", " + choix.nom + ", " + taille(choix.taille) + ".";
    } else if (estWindows) {
      bouton.href = "/";
      bouton.textContent = "Bientôt disponible sur Windows";
      el("version").textContent = "La version Windows arrive bientôt. Elle est aussi disponible sur Mac.";
    } else {
      el("version").textContent = "Version " + numero + ". Choisis ton système ci-dessous.";
    }

    var liste = el("liste");
    liste.textContent = "";
    FICHIERS.forEach(function (f) {
      var li = document.createElement("li");
      if (dispo[f.id]) {
        var a = document.createElement("a");
        a.href = dispo[f.id].url;
        a.textContent = f.nom;
        var s = document.createElement("span");
        s.textContent = taille(dispo[f.id].taille);
        li.appendChild(a); li.appendChild(s);
      } else {
        li.textContent = f.nom;
        var b = document.createElement("span");
        b.textContent = "bientôt";
        li.appendChild(b);
      }
      liste.appendChild(li);
    });
  }

  function echec() {
    el("version").textContent = "Les fichiers sont sur la page des versions.";
  }

  fetch(API, { headers: { Accept: "application/vnd.github+json" } })
    .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
    .then(afficher)
    .catch(echec);

  // Lien de secours toujours valable, même sans JavaScript ni API
  el("bouton-principal").setAttribute("data-secours", PAGE_VERSIONS);
})();

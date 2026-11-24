// getanzar.com — commun à toutes les pages : choix de langue mémorisé, bouton adapté au système.
(function () {
  "use strict";

  // Langue choisie par le visiteur : cookie lu par Caddy pour la redirection de « / ».
  // Il passe avant la langue du navigateur.
  document.addEventListener("click", function (e) {
    var lien = e.target.closest && e.target.closest("[data-langue]");
    if (!lien) return;
    var secure = location.protocol === "https:" ? "; Secure" : "";
    document.cookie = "lang=" + lien.getAttribute("data-langue") + "; Path=/; Max-Age=31536000; SameSite=Lax" + secure;
  });

  // Bouton principal de l'accueil : « Télécharger pour Mac / Windows » selon le système
  var cta = document.getElementById("cta-os");
  if (cta) {
    var ua = navigator.userAgent || "";
    var mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    var libelle = null;
    if (!mobile && /Windows/i.test(ua)) libelle = cta.getAttribute("data-windows");
    else if (!mobile && /Mac/i.test(ua)) libelle = cta.getAttribute("data-mac");
    if (libelle) cta.querySelector("span").textContent = libelle;
  }
})();

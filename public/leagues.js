// Competitions FootyScope tracks. `id` is the ESPN soccer league slug.
// tier "featured" = European cups, "top" = Europe's top 5 leagues. These are
// always shown on the home page (falling back to their latest/next matchday).
// Every other league only appears when it has matches on the selected day.
window.FOOTY_LEAGUES = [
  // European cups
  { id: "uefa.champions", name: "Champions League", region: "European Cups", tier: "featured" },
  { id: "uefa.europa", name: "Europa League", region: "European Cups", tier: "featured" },
  { id: "uefa.europa.conf", name: "Conference League", region: "European Cups", tier: "featured" },

  // Europe's top 5 leagues
  { id: "eng.1", name: "Premier League", region: "Top 5 Leagues", tier: "top" },
  { id: "esp.1", name: "LaLiga", region: "Top 5 Leagues", tier: "top" },
  { id: "ger.1", name: "Bundesliga", region: "Top 5 Leagues", tier: "top" },
  { id: "ita.1", name: "Serie A", region: "Top 5 Leagues", tier: "top" },
  { id: "fra.1", name: "Ligue 1", region: "Top 5 Leagues", tier: "top" },

  // England
  { id: "eng.2", name: "Championship", region: "England" },
  { id: "eng.3", name: "League One", region: "England" },
  { id: "eng.4", name: "League Two", region: "England" },
  { id: "eng.fa", name: "FA Cup", region: "England" },
  { id: "eng.league_cup", name: "Carabao Cup", region: "England" },
  { id: "eng.w.1", name: "Women's Super League", region: "England" },

  // Spain
  { id: "esp.2", name: "LaLiga 2", region: "Spain" },
  { id: "esp.copa_del_rey", name: "Copa del Rey", region: "Spain" },

  // Germany
  { id: "ger.2", name: "2. Bundesliga", region: "Germany" },
  { id: "ger.dfb_pokal", name: "DFB-Pokal", region: "Germany" },

  // Italy
  { id: "ita.2", name: "Serie B", region: "Italy" },
  { id: "ita.coppa_italia", name: "Coppa Italia", region: "Italy" },

  // France
  { id: "fra.2", name: "Ligue 2", region: "France" },
  { id: "fra.coupe_de_france", name: "Coupe de France", region: "France" },

  // Rest of Europe
  { id: "ned.1", name: "Eredivisie", region: "Rest of Europe" },
  { id: "por.1", name: "Primeira Liga", region: "Rest of Europe" },
  { id: "sco.1", name: "Scottish Premiership", region: "Rest of Europe" },
  { id: "bel.1", name: "Belgian Pro League", region: "Rest of Europe" },
  { id: "tur.1", name: "Turkish Süper Lig", region: "Rest of Europe" },
  { id: "gre.1", name: "Greek Super League", region: "Rest of Europe" },
  { id: "aut.1", name: "Austrian Bundesliga", region: "Rest of Europe" },
  { id: "sui.1", name: "Swiss Super League", region: "Rest of Europe" },
  { id: "den.1", name: "Danish Superliga", region: "Rest of Europe" },

  // Americas
  { id: "usa.1", name: "MLS", region: "Americas" },
  { id: "mex.1", name: "Liga MX", region: "Americas" },
  { id: "bra.1", name: "Brasileirão", region: "Americas" },
  { id: "arg.1", name: "Argentine Primera", region: "Americas" },
  { id: "conmebol.libertadores", name: "Copa Libertadores", region: "Americas" },
  { id: "conmebol.sudamericana", name: "Copa Sudamericana", region: "Americas" },

  // Rest of world
  { id: "ksa.1", name: "Saudi Pro League", region: "Rest of World" },
  { id: "jpn.1", name: "J1 League", region: "Rest of World" },
  { id: "aus.1", name: "A-League Men", region: "Rest of World" },
  { id: "afc.champions", name: "AFC Champions League Elite", region: "Rest of World" },
];

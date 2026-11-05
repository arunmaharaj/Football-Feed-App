// Competitions FootyScope tracks. `id` is the ESPN soccer league slug.
// Any league that fails to load or has no matches on a day is simply hidden.
window.FOOTY_LEAGUES = [
  // International / continental
  { id: "fifa.world", name: "FIFA World Cup", region: "International" },
  { id: "fifa.cwc", name: "FIFA Club World Cup", region: "International" },
  { id: "fifa.friendly", name: "International Friendlies", region: "International" },
  { id: "fifa.worldq.uefa", name: "WC Qualifying – UEFA", region: "International" },
  { id: "fifa.worldq.conmebol", name: "WC Qualifying – CONMEBOL", region: "International" },
  { id: "fifa.worldq.concacaf", name: "WC Qualifying – CONCACAF", region: "International" },
  { id: "fifa.worldq.afc", name: "WC Qualifying – AFC", region: "International" },
  { id: "fifa.worldq.caf", name: "WC Qualifying – CAF", region: "International" },
  { id: "uefa.euro", name: "UEFA Euro", region: "International" },
  { id: "uefa.nations", name: "UEFA Nations League", region: "International" },
  { id: "conmebol.america", name: "Copa América", region: "International" },
  { id: "caf.nations", name: "Africa Cup of Nations", region: "International" },
  { id: "afc.asian.cup", name: "AFC Asian Cup", region: "International" },
  { id: "concacaf.gold", name: "CONCACAF Gold Cup", region: "International" },

  // UEFA club
  { id: "uefa.champions", name: "UEFA Champions League", region: "Europe – UEFA" },
  { id: "uefa.europa", name: "UEFA Europa League", region: "Europe – UEFA" },
  { id: "uefa.europa.conf", name: "UEFA Conference League", region: "Europe – UEFA" },
  { id: "uefa.wchampions", name: "UEFA Women's Champions League", region: "Europe – UEFA" },

  // England
  { id: "eng.1", name: "Premier League", region: "England" },
  { id: "eng.2", name: "Championship", region: "England" },
  { id: "eng.3", name: "League One", region: "England" },
  { id: "eng.4", name: "League Two", region: "England" },
  { id: "eng.5", name: "National League", region: "England" },
  { id: "eng.fa", name: "FA Cup", region: "England" },
  { id: "eng.league_cup", name: "Carabao Cup", region: "England" },
  { id: "eng.w.1", name: "Women's Super League", region: "England" },

  // Spain
  { id: "esp.1", name: "LaLiga", region: "Spain" },
  { id: "esp.2", name: "LaLiga 2", region: "Spain" },
  { id: "esp.copa_del_rey", name: "Copa del Rey", region: "Spain" },

  // Germany
  { id: "ger.1", name: "Bundesliga", region: "Germany" },
  { id: "ger.2", name: "2. Bundesliga", region: "Germany" },
  { id: "ger.dfb_pokal", name: "DFB-Pokal", region: "Germany" },

  // Italy
  { id: "ita.1", name: "Serie A", region: "Italy" },
  { id: "ita.2", name: "Serie B", region: "Italy" },
  { id: "ita.coppa_italia", name: "Coppa Italia", region: "Italy" },

  // France
  { id: "fra.1", name: "Ligue 1", region: "France" },
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
  { id: "nor.1", name: "Eliteserien", region: "Rest of Europe" },
  { id: "swe.1", name: "Allsvenskan", region: "Rest of Europe" },
  { id: "irl.1", name: "League of Ireland", region: "Rest of Europe" },
  { id: "rus.1", name: "Russian Premier League", region: "Rest of Europe" },

  // Americas
  { id: "usa.1", name: "MLS", region: "Americas" },
  { id: "usa.nwsl", name: "NWSL", region: "Americas" },
  { id: "usa.open", name: "U.S. Open Cup", region: "Americas" },
  { id: "mex.1", name: "Liga MX", region: "Americas" },
  { id: "concacaf.champions", name: "CONCACAF Champions Cup", region: "Americas" },
  { id: "concacaf.leagues.cup", name: "Leagues Cup", region: "Americas" },
  { id: "bra.1", name: "Brasileirão Série A", region: "Americas" },
  { id: "bra.2", name: "Brasileirão Série B", region: "Americas" },
  { id: "arg.1", name: "Argentine Primera", region: "Americas" },
  { id: "col.1", name: "Colombian Primera A", region: "Americas" },
  { id: "chi.1", name: "Chilean Primera", region: "Americas" },
  { id: "uru.1", name: "Uruguayan Primera", region: "Americas" },
  { id: "conmebol.libertadores", name: "Copa Libertadores", region: "Americas" },
  { id: "conmebol.sudamericana", name: "Copa Sudamericana", region: "Americas" },

  // Asia, Oceania & Africa
  { id: "ksa.1", name: "Saudi Pro League", region: "Asia, Oceania & Africa" },
  { id: "jpn.1", name: "J1 League", region: "Asia, Oceania & Africa" },
  { id: "chn.1", name: "Chinese Super League", region: "Asia, Oceania & Africa" },
  { id: "ind.1", name: "Indian Super League", region: "Asia, Oceania & Africa" },
  { id: "aus.1", name: "A-League Men", region: "Asia, Oceania & Africa" },
  { id: "afc.champions", name: "AFC Champions League Elite", region: "Asia, Oceania & Africa" },
  { id: "rsa.1", name: "South African Premiership", region: "Asia, Oceania & Africa" },
];

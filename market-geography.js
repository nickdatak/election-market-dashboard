/* Resolve the jurisdiction holding an election from exchange metadata and race names. */
(() => {
  'use strict';

  function words(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\bU\.S(?:\.A)?\.?(?=\W|$)|\bUSA?\b/g, ' United States ')
      .replace(/\bU\.K\.?\b/gi, ' UK ')
      .replace(/&/g, ' and ')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
  }

  // Names and demonyms commonly used by the exchanges. Long names such as
  // "Northern Ireland" and "Papua New Guinea" must take precedence over their parts.
  const names = new Map();
  const places = new Map();
  function add(map, id, list) {
    for (const name of list.split('|')) map.set(words(name), id);
  }
  const features = window.ElectionCountries?.features || [];
  for (const country of features) add(names, country.id, country.name);
  const nationalAliases = {
    AFG: 'Afghan|Afghanistan',
    ALB: 'Albanian',
    DZA: 'Algerian',
    AND: 'Andorran',
    AGO: 'Angolan',
    ATG: 'Antiguan and Barbudan',
    ARG: 'Argentine|Argentinian',
    ARM: 'Armenian',
    AUS: 'Australian',
    AUT: 'Austrian',
    AZE: 'Azeri|Azerbaijani',
    BHS: 'Bahamas|Bahamian',
    BHR: 'Bahraini',
    BGD: 'Bangladeshi',
    BRB: 'Barbadian',
    BLR: 'Belarusian',
    BEL: 'Belgian',
    BLZ: 'Belizean',
    BEN: 'Beninese',
    BTN: 'Bhutanese',
    BOL: 'Bolivian',
    BIH: 'Bosnia|Bosnian|Bosnian and Herzegovinian',
    BWA: 'Botswanan|Batswana',
    BRA: 'Brazilian',
    BRN: 'Bruneian',
    BGR: 'Bulgarian',
    BFA: 'Burkinabe',
    BDI: 'Burundian',
    CPV: 'Cabo Verde|Cape Verdean|Cabo Verdean',
    KHM: 'Cambodian',
    CMR: 'Cameroonian',
    CAN: 'Canadian',
    CAF: 'Central African Republic',
    TCD: 'Chadian',
    CHL: 'Chilean',
    CHN: "People's Republic of China|PRC|Chinese",
    COL: 'Colombian',
    COM: 'Comorian',
    COG: 'Congo Brazzaville|Republic of Congo',
    COD: 'DR Congo|DRC|Congo Kinshasa|Democratic Republic of Congo',
    CRI: 'Costa Rican',
    CIV: 'Ivory Coast|Ivorian',
    HRV: 'Croatian',
    CUB: 'Cuban',
    CYP: 'Cypriot',
    CZE: 'Czech Republic|Czech',
    DNK: 'Danish',
    DJI: 'Djiboutian',
    DMA: 'Dominica',
    DOM: 'Dominican Republic|Dominican',
    ECU: 'Ecuadorian|Ecuadorean',
    EGY: 'Egyptian',
    SLV: 'Salvadoran|Salvadorean',
    GNQ: 'Equatoguinean',
    ERI: 'Eritrean',
    EST: 'Estonian',
    SWZ: 'Swaziland|Swazi',
    ETH: 'Ethiopian',
    FJI: 'Fijian',
    FIN: 'Finnish',
    FRA: 'French',
    GAB: 'Gabonese',
    GMB: 'Gambia|Gambian',
    GEO: 'Georgian',
    DEU: 'German',
    GHA: 'Ghanaian',
    GRC: 'Greek',
    GRL: 'Greenlandic',
    GRD: 'Grenadian',
    GTM: 'Guatemalan',
    GIN: 'Guinean',
    GNB: 'Guinea Bissauan',
    GUY: 'Guyanese',
    HTI: 'Haitian',
    HND: 'Honduran',
    HUN: 'Hungarian',
    ISL: 'Icelandic',
    IND: 'Indian',
    IDN: 'Indonesian',
    IRN: 'Iranian',
    IRQ: 'Iraqi',
    IRL: 'Irish|Republic of Ireland',
    ISR: 'Israeli',
    ITA: 'Italian',
    JAM: 'Jamaican',
    JPN: 'Japanese',
    JOR: 'Jordanian',
    KAZ: 'Kazakh|Kazakhstani',
    KEN: 'Kenyan',
    KIR: 'I Kiribati',
    PRK: 'North Korean|DPRK',
    KOR: 'South Korean|Republic of Korea',
    XKX: 'Kosovan|Kosovar',
    KWT: 'Kuwaiti',
    KGZ: 'Kyrgyz',
    LAO: 'Lao|Laotian',
    LVA: 'Latvian',
    LBN: 'Lebanese',
    LSO: 'Basotho',
    LBR: 'Liberian',
    LBY: 'Libyan',
    LIE: 'Liechtensteiner',
    LTU: 'Lithuanian',
    LUX: 'Luxembourgish',
    MDG: 'Malagasy',
    MWI: 'Malawian',
    MYS: 'Malaysian',
    MDV: 'Maldivian',
    MLI: 'Malian',
    MLT: 'Maltese',
    MHL: 'Marshallese',
    MRT: 'Mauritanian',
    MUS: 'Mauritian',
    MEX: 'Mexican',
    FSM: 'Micronesia|Micronesian',
    MDA: 'Moldovan',
    MCO: 'Monegasque',
    MNG: 'Mongolian',
    MNE: 'Montenegrin',
    MAR: 'Moroccan',
    MOZ: 'Mozambican',
    MMR: 'Burma|Burmese',
    NAM: 'Namibian',
    NRU: 'Nauruan',
    NPL: 'Nepali|Nepalese',
    NLD: 'Dutch|The Netherlands',
    NZL: 'New Zealand|New Zealander',
    NIC: 'Nicaraguan',
    NER: 'Nigerien',
    NGA: 'Nigerian',
    MKD: 'Macedonian|North Macedonian',
    NOR: 'Norwegian',
    OMN: 'Omani',
    PAK: 'Pakistani',
    PLW: 'Palauan',
    PSE: 'Palestinian',
    PAN: 'Panamanian',
    PNG: 'Papua New Guinean',
    PRY: 'Paraguayan',
    PER: 'Peruvian',
    PHL: 'Philippine|Filipino',
    POL: 'Polish',
    PRT: 'Portuguese',
    QAT: 'Qatari',
    ROU: 'Romanian',
    RUS: 'Russian|Russian Federation',
    RWA: 'Rwandan',
    WSM: 'Samoan',
    SMR: 'Sammarinese',
    STP: 'Sao Tomean',
    SAU: 'Saudi|Saudi Arabian',
    SEN: 'Senegalese',
    SRB: 'Serbian',
    SYC: 'Seychellois',
    SLE: 'Sierra Leonean',
    SGP: 'Singaporean',
    SVK: 'Slovak|Slovakian',
    SVN: 'Slovenian|Slovene',
    SLB: 'Solomon Islands',
    SOM: 'Somali',
    ZAF: 'South African',
    SSD: 'South Sudanese',
    ESP: 'Spanish',
    LKA: 'Sri Lankan',
    SDN: 'Sudanese',
    SUR: 'Surinamese',
    SWE: 'Swedish',
    CHE: 'Swiss',
    SYR: 'Syrian',
    TWN: 'Taiwanese|Republic of China',
    TJK: 'Tajik|Tajikistani',
    TZA: 'Tanzanian',
    THA: 'Thai',
    TLS: 'East Timor|East Timorese|Timorese',
    TGO: 'Togolese',
    TON: 'Tongan',
    TTO: 'Trinidadian|Trinidad and Tobago',
    TUN: 'Tunisian',
    TUR: 'Turkey|Turkish',
    TKM: 'Turkmen',
    TUV: 'Tuvaluan',
    UGA: 'Ugandan',
    UKR: 'Ukrainian',
    ARE: 'UAE|Emirati',
    GBR: 'UK|United Kingdom|Great Britain|British|Britain|England|English|Scotland|Scottish|England and Wales|Wales|Welsh|Northern Ireland|Northern Irish',
    USA: 'United States|United States of America|American',
    URY: 'Uruguayan',
    UZB: 'Uzbek|Uzbekistani',
    VUT: 'Ni Vanuatu',
    VAT: 'Vatican|Holy See',
    VEN: 'Venezuelan',
    VNM: 'Vietnamese|Viet Nam',
    YEM: 'Yemeni',
    ZMB: 'Zambian',
    ZWE: 'Zimbabwean',
    FRO: 'Faroese',
    HKG: 'Hong Kong',
    PRI: 'Puerto Rican',
    IMN: 'Manx',
    CYN: 'Turkish Republic of Northern Cyprus',
    ASM: 'American Samoan',
    PYF: 'French Polynesian',
    VIR: 'US Virgin Islands|U.S. Virgin Islands',
    NCL: 'New Caledonian',
  };
  for (const [id, list] of Object.entries(nationalAliases)) add(names, id, list);

  // Local and provincial elections usually name only the jurisdiction in the ballot.
  const localNames = {
    USA: 'Alabama|Alaska|Arizona|Arkansas|California|Colorado|Connecticut|Delaware|District of Columbia|Florida|Hawaii|Idaho|Illinois|Indiana|Iowa|Kansas|Kentucky|Louisiana|Maine|Maryland|Massachusetts|Michigan|Minnesota|Mississippi|Missouri|Montana|Nebraska|Nevada|New Hampshire|New Jersey|New Mexico|New York|New York City|North Carolina|North Dakota|Ohio|Oklahoma|Oregon|Pennsylvania|Rhode Island|South Carolina|South Dakota|Tennessee|Texas|Utah|Vermont|Virginia|Washington|Washington DC|West Virginia|Wisconsin|Wyoming|San Francisco|San Diego|Sacramento|San Jose|Los Angeles|Chicago|Philadelphia|Houston|Phoenix|San Antonio|Dallas|Austin|Fort Worth|El Paso|Boston|Seattle|Portland Oregon|Las Vegas|Denver|Atlanta|Detroit|Miami|Jacksonville|Orlando|Baltimore|New Orleans|Minneapolis|Nashville|Memphis|Milwaukee|NYC|Buffalo|Pittsburgh|Charlotte|Louisville|Anchorage|Honolulu|Albuquerque|Omaha|Bexar County',
    CAN: 'Ontario|Quebec|British Columbia|Alberta|Manitoba|Saskatchewan|Nova Scotia|New Brunswick|Prince Edward Island|Newfoundland and Labrador|Nunavut|Yukon|Northwest Territories|Vancouver|Ottawa|Toronto|Montreal|Edmonton|Calgary|Winnipeg|Regina|Mississauga|Abbotsford|Kelowna|Nanaimo|Coquitlam|Kamloops|Niagara on the Lake|Revelstoke|Saanich|Oshawa|Prince George|Trois Rivieres|Brantford Brant South',
    GBR: 'London|Greater London|Greater Manchester|Edinburgh|Glasgow|Cardiff|Belfast|Leicester|Liverpool|Middlesbrough|Cumbria|Cheshire and Warrington|Holborn and St Pancras|Clacton|Aberdeen South|Gorton and Denton|Arbroath and Broughty Ferry|Makerfield',
    AUS: 'Victorian|New South Wales|NSW|Queensland|Tasmania|South Australia|Western Australia|Northern Territory|Australian Capital Territory|Sydney|Melbourne|Hobart|Brisbane|Adelaide|Canberra|Launceston|Huon Valley|Waratah Wynyard',
    TWN: 'Taipei|New Taipei|Taipei City|Taichung|Tainan|Kaohsiung|Taoyuan|Hsinchu City|Hsinchu County|Hualien|Keelung',
    SVN: 'Ljubljana|Maribor',
    FRA: 'Paris|Marseille|Lyon|Toulouse|Bordeaux',
    ESP: 'Madrid|Barcelona|Catalonia|Catalan|Basque Country|Andalusia|Galicia|Balearic Islands|Asturias|Navarre|Valencian|Castilla La Mancha|Valladolid|Seville',
    DEU: 'Berlin|Bavaria|Bavarian|Hesse|Hamburg|Bremen|Thuringia|Brandenburg|Lower Saxony|Saxony|Saxony Anhalt|Baden Wurttemberg|North Rhine Westphalia|Rhineland Palatinate|Mecklenburg Vorpommern|Schleswig Holstein|Saarland|Munich|Hannover|Osnabruck|Gottingen',
    ITA: 'Rome|Milan|Palermo|Turin|Verona|Sicily|Tuscany|Sardinia',
    KOR: 'Seoul|Busan|Daegu|Gangneung',
    JPN: 'Tokyo|Osaka|Hokkaido|Okinawa|Kanagawa|Sapporo|Yokohama',
    MEX: 'Mexico City|Ciudad de Mexico|Guadalajara|Monterrey|Ciudad Juarez|Tijuana|Baja California|Baja California Sur|Quintana Roo|Aguascalientes|Nuevo Leon|San Luis Potosi|Tlaxcala|Chihuahua|Zacatecas|Puebla|Sinaloa|Colima|Guerrero|Queretaro|Nayarit|Michoacan|Sonora',
    BRA: 'Brasilia|Sao Paulo|Rio de Janeiro|Minas Gerais|Bahia|Ceara|Espirito Santo|Paraiba|Pernambuco|Rio Grande do Sul|Rio Grande do Norte|Tocantins|Santa Catarina',
    IND: 'Delhi|New Delhi|Mumbai|Kolkata|Chennai|Uttar Pradesh|Maharashtra|West Bengal|Tamil Nadu|Karnataka|Goa|Manipur|Uttarakhand',
    NGA: 'Lagos|Kano State|Akwa Ibom|Adamawa State|Bauchi State|Benue State|Gombe State|Kaduna State|Katsina State|Nasarawa State',
    POL: 'Warsaw|Krakow',
    AUT: 'Vienna|Linz|Upper Austria',
    NOR: 'Oslo|Bergen',
    NLD: 'Amsterdam|Rotterdam',
    CZE: 'Prague',
    IRL: 'Dublin',
    HUN: 'Budapest',
    SVK: 'Bratislava|Presov',
    LTU: 'Vilnius',
    PRT: 'Lisbon',
    DNK: 'Copenhagen',
    SWE: 'Stockholm',
    FIN: 'Helsinki',
    CHE: 'Zurich|Geneva|Bern',
    RUS: 'Moscow',
    UKR: 'Kyiv|Kiev',
    MNE: 'Podgorica',
    ALB: 'Tirana',
    LIE: 'Vaduz',
    BIH: 'Republika Srpska',
    MDA: 'Gagauzia',
    TUR: 'Istanbul|Ankara',
    ISR: 'Tel Aviv',
    THA: 'Bangkok',
    IDN: 'Jakarta',
    MYS: 'Sarawak|Malacca|Kuala Lumpur',
    PHL: 'Manila|Bangsamoro',
    NPL: 'Kathmandu',
    NZL: 'Auckland|Greater Wellington Wairarapa|Porirua|Waitaki',
    ARG: 'Buenos Aires|Tucuman',
    PER: 'Lima|Arequipa|Piura',
    ECU: 'Quito|Guayaquil|Pichincha|Azuay',
    KEN: 'Nairobi',
    ZAF: 'Johannesburg|Cape Town',
    CHL: 'Santiago de Chile',
  };
  for (const [id, list] of Object.entries(localNames)) add(places, id, list);

  const aliases = new Map([...names, ...places]);
  const alternatives = [...aliases.keys()].sort((a, b) => b.length - a.length).join('|');
  const locationPattern = new RegExp('\\b(?:' + alternatives + ')\\b', 'g');
  const byId = new Set(features.map((country) => country.id));
  const office =
    '(?:election(?:s)?|electoral|ballot|referend(?:a|ums?)|plebiscite|presiden(?:tial|ts?|cy)|vice presidential|pm|premier(?:ship)?|prime minister|chancellor(?:ship)?|senat(?:e|or|orial)|house|parliament(?:ary)?|government|coalition|govern(?:or|orship|ment)|gubernatorial|attorney general|secretary of state|mayor(?:al|ship)?|magistrate|prefect|chief (?:minister|justice)|legislat(?:ive|ure)|assembly|congress(?:ional)?|council(?:lor)?|chamber|deputies|justice minister|by election|primary|primaries|runoff|vote(?:s|r|rs)?|nominee|nominat(?:ion|ee)|constituency|district|corts|riksdag|knesset|sejm|duma|bundestag|independence)';
  const modifiers =
    '(?:(?:s|the|a|next|new|snap|local|general|national|recall|federal|provincial|regional|municipal|city|county|state|statewide|territorial|borough|legislative|constitutional|separation|first|second|round|midterm|midterms|popular|special|lord|deputy|party|republican|democrat(?:ic)?|20\\d{2}) )*';
  const officeAfter = new RegExp('^' + modifiers + office + '\\b');
  const officeBefore = new RegExp(
    '\\b' +
      office +
      '(?: election| elections| race| seat| seats| nominee| candidate| vote| majority| turnout)? (?:of|in|for|across)(?: the)?$',
  );
  const ballot = '(?:elections?|referend(?:a|ums?)|plebiscite|ballot|runoff|primar(?:y|ies)|nomination)';
  const ballotAfter = new RegExp(
    '^' +
      modifiers +
      '(?:(?:presidential|parliamentary|senate|house|mayoral|gubernatorial|assembly|governor|mayor|council|by) )?' +
      ballot +
      '\\b',
  );
  const ballotBefore = new RegExp('\\b' + ballot + ' (?:in|of|for|across)(?: the)?$');
  const directVote =
    /\b(?:win(?:s)?|carry|carries|flip|lead|prevail|majority|seat(?:s)?|turnout|margin of victory|vote share|government) (?:in |across |from )?(?:the )?$/;
  const incumbentAction =
    /^(?:s )?(?:president|senator|governor|pm|prime minister|chancellor|mayor) (?:will |to )?(?:endors|visit|campaign|back |support|influenc|interfer|comment|meet|congratulat|attend|speak|predict|respon|recogniz|recognis)/;
  const stateCode =
    '(?:AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)';
  const usDistrict = new RegExp('\\b' + stateCode + '\\s*[-–]\\s*\\d{1,2}\\b', 'i');
  const stateRace = new RegExp(
    '\\b(?:' +
      stateCode +
      ' (?:[Gg]overnor|[Gg]ubernatorial|[Ss]enate|[Pp]rimary|[Ss]tate [Ss]upreme [Cc]ourt)|[Hh]ouse ' +
      stateCode +
      ' \\d{1,2})\\b',
  );
  const kalshiStateRace = new RegExp(
    '^(?:ND)?(?:KX)?(?:HOUSE' +
      stateCode +
      '\\d{1,2}[DSR]?|SENATE(?:PARTY-?)?' +
      stateCode +
      '[DR]?|GOV(?:PARTY)?' +
      stateCode +
      '(?:NOM[RD])?|PRESPARTY' +
      stateCode +
      '\\d?|ATTYGEN' +
      stateCode +
      '|STATELEG' +
      stateCode +
      '|' +
      stateCode +
      'STATELEG)$',
  );
  const districtElection =
    /\b(?:election|seat|house|primary|district|nominee|nomination|congress|special|winner|win)\b/;
  const usGeorgia =
    /\bgeorgia(?: s)? (?:(?:20\d\d|state|special|democratic|republican) )*(?:governor|gubernatorial|senat\w*|house|secretary of state|attorney general|electoral votes|congressional|primary|primaries)\b|\b(?:governor|senator|congressional district|senate race|electoral votes|gubernatorial election|attorney general|secretary of state) (?:of|in|for|from) georgia\b/;
  const nationalGeorgia =
    /\b(?:georgia(?: s)?|georgian) (?:(?:next|national|snap|20\d\d) )*(?:parliament|president|prime minister|government)|\b(?:prime minister|parliament|president) of georgia\b/;
  const australianVictoria =
    /\bvicto(?:ria|rian)(?: s)? (?:(?:state|parliamentary|legislative) (?:election|assembly)|premier)|\bpremier of victoria\b/;
  const institutionRules = [
    ['ISR', /\bknesset\b/],
    ['DEU', /\bbundestag\b/],
    ['SWE', /\briksdag\b/],
    ['FRA', /\belysee\b/],
    ['POL', /\bsejm\b/],
    ['ESP', /\bcongreso de los diputados\b/],
    ['IND', /\b(?:lok sabha|rajya sabha)\b/],
    ['IRL', /\b(?:taoiseach|dail eireann|oireachtas)\b/],
    ['GBR', /\b(?:downing street|westminster parliament|senedd|holyrood)\b/],
    ['TWN', /\blegislative yuan\b/],
    ['NZL', /\bbeehive parliament\b/],
    ['RUS', /\bstate duma\b/],
    [
      'USA',
      /\b(?:white house|electoral college votes|electoral college winner|senate (?:democratic|republican) leader|house (?:democratic|republican) (?:leader|caucus))\b/,
    ],
  ];

  function titleCountries(raw) {
    // A normalized Kalshi title may append the option (including countries
    // where expatriates cast ballots) after a middle dot.
    const source = String(raw || '').split(' · ')[0];
    const text = words(source);
    if (!text) return [];
    const matches = Array.from(text.matchAll(locationPattern), (match) => {
      const name = match[0];
      const before = text.slice(0, match.index).trimEnd();
      const after = text.slice(match.index + name.length).trimStart();
      let id = aliases.get(name);
      let relevant =
        officeBefore.test(before) ||
        officeAfter.test(after) ||
        directVote.test(before + ' ') ||
        /^(?:will )?(?:hold|call|stage|schedule|postpone|cancel|have) (?:an? |its |the )?(?:snap |general |national |presidential |parliamentary )?(?:election|referendum)/.test(
          after,
        ) ||
        /^(?:who|which party) will (?:win|govern|form the next government)\b/.test(after);
      if (name === 'georgia' || name === 'georgian') {
        if (usGeorgia.test(text)) id = 'USA';
        else if (!nationalGeorgia.test(text)) relevant = false;
      }
      if (
        incumbentAction.test(after) ||
        (name === 'american' && /\b(?:latin|south|north|central)\s*$/.test(before))
      )
        relevant = false;
      const explicitBallot = ballotBefore.test(before) || ballotAfter.test(after);
      return {
        id,
        start: match.index,
        end: match.index + name.length,
        strength: relevant ? (explicitBallot ? 2 : 1) : 0,
      };
    });
    // In "elections in France and Germany", both names share the same office.
    for (let start = 0; start < matches.length;) {
      let end = start + 1;
      while (
        end < matches.length &&
        /^\s+(?:and|or|versus|vs)\s+(?:the )?$/.test(text.slice(matches[end - 1].end, matches[end].start))
      )
        end++;
      const group = matches.slice(start, end);
      const strength = Math.max(...group.map((match) => match.strength));
      group.forEach((match) => {
        match.strength = strength;
      });
      start = end;
    }
    // A race explicitly named in the title takes precedence over the nationality
    // of a visiting officeholder or the location where overseas votes are counted.
    const minimum = /\b(?:combo|combination|both)\b/.test(text)
      ? 1
      : Math.max(1, ...matches.map((match) => match.strength));
    const result = new Set(matches.filter((match) => match.strength >= minimum).map((match) => match.id));
    if (australianVictoria.test(text)) result.add('AUS');
    if ((usDistrict.test(source) && districtElection.test(text)) || stateRace.test(source)) result.add('USA');
    if (!result.size) for (const [id, pattern] of institutionRules) if (pattern.test(text)) result.add(id);
    return [...result];
  }

  // These exchange identifiers explicitly identify US races even when the
  // exchange omits the country from the title or old archive metadata.
  const usPolymarket = new Set([
    'presidential-election-winner-2024',
    'presidential-election-winner-2028',
    'presidential-election-popular-vote-winner-2024',
    'democratic-nominee-2024',
    'democratic-presidential-nominee-2028',
    'republican-presidential-nominee-2028',
    'which-party-will-win-the-house-in-2026',
    'next-senate-majority-leader-485',
  ]);
  const knownKalshi = {
    KXPRESPERSON: ['USA'],
    KXVPRESPERSON: ['USA'],
    KXSENATEDEMLEAD: ['USA'],
    KXVICTORIANSTATE: ['AUS'],
    KXBRISRAELSENCOMBO: ['BRA', 'ISR', 'USA'],
    KXSTPETERSBURGMAYOR: ['USA'],
    KXNEWPOPE: ['VAT'],
    KXNEXTPOPE: ['VAT'],
    POWER: ['USA'],
    ECMOV: ['USA'],
    POPVOTEMOV: ['USA'],
    POPVOTEMOVSMALL: ['USA'],
    POPVOTEMOVSMALLER: ['USA'],
    KXDSENATESEATS: ['USA'],
    KXDSENATESEATSH: ['USA'],
    RSENATESEATS: ['USA'],
    KXDHOUSESEATS: ['USA'],
    KXRHOUSESEATS: ['USA'],
    KXBRUVSEAT: ['GBR'],
    KXJAPANHOC: ['JPN'],
    KXSWINGSTATES24DJT: ['USA'],
    RHOUSESEATS: ['USA'],
    KXPUNJABASSEMBLY: ['IND'],
    KXCLARENCEMAYOR: ['AUS'],
    KXNORTHMIDLANDSMAYOR: ['AUS'],
    KXBOSNIACPRES: ['BIH'],
    KXBOSNIAKPRES: ['BIH'],
    KXBOSNIASPRES: ['BIH'],
  };
  const exchangeTags = {
    'us elections': 'USA',
    'other us elections': 'USA',
    'united states elections': 'USA',
    'other united states elections': 'USA',
    'us senate': 'USA',
    'united states senate': 'USA',
    'us house': 'USA',
    'united states house': 'USA',
    'united states politics': 'USA',
  };

  // ISO alpha-2 values are accepted only in the explicit country field.
  const countryCodes = new Map();
  const codePairs = [
    'AD AND AE ARE AF AFG AG ATG AI AIA AL ALB AM ARM AO AGO AQ ATA AR ARG AS ASM AT AUT AU AUS AW ABW AX ALA',
    'AZ AZE BA BIH BB BRB BD BGD BE BEL BF BFA BG BGR BH BHR BI BDI BJ BEN BL BLM BM BMU BN BRN BO BOL BR BRA',
    'BS BHS BT BTN BW BWA BY BLR BZ BLZ CA CAN CD COD CF CAF CG COG CH CHE CI CIV CK COK CL CHL CM CMR CN CHN',
    'CN-TW TWN CO COL CR CRI CU CUB CV CPV CW CUW CY CYP CZ CZE DE DEU DJ DJI DK DNK DM DMA DO DOM DZ DZA EC ECU',
    'EE EST EG EGY EH ESH ER ERI ES ESP ET ETH FI FIN FJ FJI FK FLK FM FSM FO FRO FR FRA GA GAB GB GBR GD GRD',
    'GE GEO GG GGY GH GHA GL GRL GM GMB GN GIN GQ GNQ GR GRC GS SGS GT GTM GU GUM GW GNB GY GUY HK HKG HM HMD',
    'HN HND HR HRV HT HTI HU HUN ID IDN IE IRL IL ISR IM IMN IN IND IO IOT IQ IRQ IR IRN IS ISL IT ITA JE JEY',
    'JM JAM JO JOR JP JPN KE KEN KG KGZ KH KHM KI KIR KM COM KN KNA KP PRK KR KOR KW KWT KY CYM KZ KAZ LA LAO',
    'LB LBN LC LCA LI LIE LK LKA LR LBR LS LSO LT LTU LU LUX LV LVA LY LBY MA MAR MC MCO MD MDA ME MNE MF MAF',
    'MG MDG MH MHL MK MKD ML MLI MM MMR MN MNG MO MAC MP MNP MR MRT MS MSR MT MLT MU MUS MV MDV MW MWI MX MEX',
    'MY MYS MZ MOZ NA NAM NC NCL NE NER NF NFK NG NGA NI NIC NL NLD NO NOR NP NPL NR NRU NU NIU NZ NZL OM OMN',
    'PA PAN PE PER PF PYF PG PNG PH PHL PK PAK PL POL PM SPM PN PCN PR PRI PS PSE PT PRT PW PLW PY PRY QA QAT',
    'RO ROU RS SRB RU RUS RW RWA SA SAU SB SLB SC SYC SD SDN SE SWE SG SGP SH SHN SI SVN SK SVK SL SLE SM SMR',
    'SN SEN SO SOM SR SUR SS SSD ST STP SV SLV SX SXM SY SYR SZ SWZ TC TCA TD TCD TF ATF TG TGO TH THA TJ TJK',
    'TL TLS TM TKM TN TUN TO TON TR TUR TT TTO TV TUV TZ TZA UA UKR UG UGA US USA UY URY UZ UZB VA VAT VC VCT',
    'VE VEN VG VGB VI VIR VN VNM VU VUT WF WLF WS WSM XK XKX YE YEM ZA ZAF ZM ZMB ZW ZWE',
  ]
    .join(' ')
    .split(' ');
  for (let i = 0; i < codePairs.length; i += 2) countryCodes.set(codePairs[i], codePairs[i + 1]);

  function explicitCountry(value, allowCodes = false) {
    if (typeof value !== 'string') return null;
    const name = words(value);
    const code = value.trim().toUpperCase();
    if (names.has(name)) return names.get(name);
    if (Object.hasOwn(exchangeTags, name)) return exchangeTags[name];
    if (allowCodes) return countryCodes.get(code) || (byId.has(code) ? code : null);
    return null;
  }

  function countryIds(market) {
    if (!market || typeof market !== 'object') return [];
    const country = explicitCountry(market.countryName, true);
    if (country) return [country];
    if (market.source === 'kalshi') {
      const series = market.seriesTicker || String(market.eventId || market.id || '').split('-')[0];
      if (Object.hasOwn(knownKalshi, series)) return [...knownKalshi[series]];
      if (kalshiStateRace.test(series)) return ['USA'];
      const tags = Array.isArray(market.seriesTags) ? market.seriesTags : [];
      const countries = [...new Set(tags.map((tag) => explicitCountry(tag)).filter(Boolean))];
      if (countries.length && !tags.includes('Election Combos')) return countries;
      if (countries.length) return [...new Set([...titleCountries(market.eventTitle), ...countries])];
    }
    if (market.source === 'polymarket' && market.url) {
      try {
        const url = new URL(market.url);
        const [, kind, slug] = url.pathname.split('/');
        if (url.hostname === 'polymarket.com' && kind === 'event' && usPolymarket.has(slug)) return ['USA'];
      } catch {
        /* Titles can still locate a contract with an incomplete link. */
      }
    }
    const event = titleCountries(market.eventTitle);
    return event.length ? event : titleCountries(market.title);
  }

  window.ElectionGeography = { countryIds };
})();

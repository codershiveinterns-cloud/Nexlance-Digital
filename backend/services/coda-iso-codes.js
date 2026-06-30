const ISO_4217_NUMERIC_CODES = Object.freeze({
    AED: '784',
    ARS: '032',
    AUD: '036',
    BDT: '050',
    BHD: '048',
    BOB: '068',
    BRL: '986',
    CAD: '124',
    CHF: '756',
    CLP: '152',
    CNY: '156',
    COP: '170',
    CZK: '203',
    DKK: '208',
    DOP: '214',
    DZD: '012',
    EGP: '818',
    EUR: '978',
    GBP: '826',
    GHS: '936',
    GTQ: '320',
    HKD: '344',
    HUF: '348',
    IDR: '360',
    ILS: '376',
    INR: '356',
    IQD: '368',
    JPY: '392',
    KES: '404',
    KRW: '410',
    KWD: '414',
    KZT: '398',
    LAK: '418',
    LKR: '144',
    MAD: '504',
    MMK: '104',
    MNT: '496',
    MXN: '484',
    MYR: '458',
    NGN: '566',
    NOK: '578',
    NPR: '524',
    NZD: '554',
    PEN: '604',
    PHP: '608',
    PKR: '586',
    PLN: '985',
    PYG: '600',
    QAR: '634',
    RON: '946',
    SAR: '682',
    SEK: '752',
    SGD: '702',
    THB: '764',
    TND: '788',
    TRY: '949',
    TWD: '901',
    UAH: '980',
    USD: '840',
    UYU: '858',
    UZS: '860',
    VND: '704',
    ZAR: '710'
});

const ISO_3166_NUMERIC_CODES = Object.freeze({
    AE: '784',
    ALGERIA: '012',
    AMERICA: '840',
    ARGENTINA: '032',
    AR: '032',
    AU: '036',
    AUSTRALIA: '036',
    AUSTRIA: '040',
    AT: '040',
    BAHRAIN: '048',
    BANGLADESH: '050',
    BD: '050',
    BE: '056',
    BELGIUM: '056',
    BOLIVIA: '068',
    BO: '068',
    BRAZIL: '076',
    BR: '076',
    BURMA: '104',
    CA: '124',
    CAMBODIA: '116',
    CANADA: '124',
    CH: '756',
    CHILE: '152',
    CHINA: '156',
    CN: '156',
    CO: '170',
    COLOMBIA: '170',
    CY: '196',
    CYPRUS: '196',
    CZECHIA: '203',
    CZECH_REPUBLIC: '203',
    DE: '276',
    DENMARK: '208',
    DK: '208',
    DO: '214',
    DOMINICAN_REPUBLIC: '214',
    DZ: '012',
    EAST_TIMOR: '626',
    EC: '218',
    ECUADOR: '218',
    EE: '233',
    EGYPT: '818',
    ES: '724',
    ESTONIA: '233',
    FI: '246',
    FINLAND: '246',
    FR: '250',
    FRANCE: '250',
    GB: '826',
    GERMANY: '276',
    GH: '288',
    GHANA: '288',
    GREAT_BRITAIN: '826',
    GREECE: '300',
    GR: '300',
    GT: '320',
    GUATEMALA: '320',
    HONG_KONG: '344',
    HK: '344',
    HU: '348',
    HUNGARY: '348',
    ID: '360',
    IE: '372',
    IL: '376',
    IN: '356',
    INDIA: '356',
    INDONESIA: '360',
    IQ: '368',
    IRAQ: '368',
    IRELAND: '372',
    ISRAEL: '376',
    IT: '380',
    ITALY: '380',
    JAPAN: '392',
    JP: '392',
    KAZAKHSTAN: '398',
    KE: '404',
    KENYA: '404',
    KH: '116',
    KOREA: '410',
    KR: '410',
    KUWAIT: '414',
    KW: '414',
    KZ: '398',
    LA: '418',
    LAO_PDR: '418',
    LAOS: '418',
    LATVIA: '428',
    LITHUANIA: '440',
    LK: '144',
    LT: '440',
    LU: '442',
    LUXEMBOURG: '442',
    LV: '428',
    MALAYSIA: '458',
    MALTA: '470',
    MA: '504',
    MEXICO: '484',
    MM: '104',
    MN: '496',
    MONGOLIA: '496',
    MOROCCO: '504',
    MT: '470',
    MX: '484',
    MY: '458',
    MYANMAR: '104',
    NEPAL: '524',
    NETHERLANDS: '528',
    NEW_ZEALAND: '554',
    NG: '566',
    NIGERIA: '566',
    NL: '528',
    NORWAY: '578',
    NO: '578',
    NP: '524',
    NZ: '554',
    PAKISTAN: '586',
    PALESTINE: '275',
    PARAGUAY: '600',
    PE: '604',
    PERU: '604',
    PH: '608',
    PHILIPPINES: '608',
    PK: '586',
    PL: '616',
    POLAND: '616',
    PORTUGAL: '620',
    PR: '630',
    PUERTO_RICO: '630',
    PT: '620',
    PY: '600',
    QA: '634',
    QATAR: '634',
    REPUBLIC_OF_IRELAND: '372',
    RO: '642',
    ROMANIA: '642',
    SA: '682',
    SAUDI_ARABIA: '682',
    SCOTLAND: '826',
    SE: '752',
    SG: '702',
    SINGAPORE: '702',
    SI: '705',
    SK: '703',
    SLOVAKIA: '703',
    SLOVENIA: '705',
    SOUTH_AFRICA: '710',
    SOUTH_KOREA: '410',
    SPAIN: '724',
    SRI_LANKA: '144',
    SWEDEN: '752',
    SWITZERLAND: '756',
    TAIWAN: '158',
    TH: '764',
    THAILAND: '764',
    TIMOR_LESTE: '626',
    TL: '626',
    TN: '788',
    TR: '792',
    TUNISIA: '788',
    TURKEY: '792',
    TURKIYE: '792',
    TW: '158',
    UA: '804',
    UAE: '784',
    UK: '826',
    UKRAINE: '804',
    UNITED_ARAB_EMIRATES: '784',
    UNITED_KINGDOM: '826',
    UNITED_STATES: '840',
    UNITED_STATES_OF_AMERICA: '840',
    URUGUAY: '858',
    US: '840',
    USA: '840',
    UY: '858',
    UZ: '860',
    UZBEKISTAN: '860',
    VIET_NAM: '704',
    VIETNAM: '704',
    VN: '704',
    WALES: '826',
    ZA: '710'
});

function normalizeNumericCode(value) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 999) {
        return String(value).padStart(3, '0');
    }

    const normalized = String(value || '').trim();
    if (/^\d{1,3}$/.test(normalized)) {
        return normalized.padStart(3, '0');
    }

    return '';
}

function normalizeCurrencyKey(value) {
    return String(value || '').trim().toUpperCase();
}

function normalizeCountryKey(value) {
    return String(value || '')
        .trim()
        .toUpperCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\([^)]*\)/g, ' ')
        .replace(/[^A-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .replace(/_+/g, '_');
}

function isSupportedNumericCode(code, lookup) {
    return Object.values(lookup).includes(code);
}

function resolveIso4217NumericCode(currency) {
    const numericCode = normalizeNumericCode(currency);
    if (numericCode && isSupportedNumericCode(numericCode, ISO_4217_NUMERIC_CODES)) {
        return Number(numericCode);
    }

    const code = ISO_4217_NUMERIC_CODES[normalizeCurrencyKey(currency)];
    if (code) {
        return Number(code);
    }

    throw new Error(`Unsupported Coda currency: ${String(currency || '').trim() || '(empty)'}. Add an ISO 4217 numeric mapping before using it.`);
}

function resolveIso3166NumericCode(country) {
    const numericCode = normalizeNumericCode(country);
    if (numericCode && isSupportedNumericCode(numericCode, ISO_3166_NUMERIC_CODES)) {
        return Number(numericCode);
    }

    const code = ISO_3166_NUMERIC_CODES[normalizeCountryKey(country)];
    if (code) {
        return Number(code);
    }

    throw new Error(`Unsupported Coda country: ${String(country || '').trim() || '(empty)'}. Add an ISO 3166 numeric mapping before using it.`);
}

module.exports = {
    ISO_3166_NUMERIC_CODES,
    ISO_4217_NUMERIC_CODES,
    resolveIso3166NumericCode,
    resolveIso4217NumericCode
};

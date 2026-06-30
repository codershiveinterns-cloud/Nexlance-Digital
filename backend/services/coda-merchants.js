const CODA_MERCHANTS = Object.freeze([
    { merchantId: '431597', country: 'Algeria', aliases: ['DZ'] },
    { merchantId: '431598', country: 'Argentina', aliases: ['AR'] },
    { merchantId: '431599', country: 'Australia', aliases: ['AU'] },
    { merchantId: '431600', country: 'Austria', aliases: ['AT'] },
    { merchantId: '431601', country: 'Bahrain', aliases: ['BH'] },
    { merchantId: '431602', country: 'Bangladesh', aliases: ['BD'] },
    { merchantId: '431603', country: 'Belgium', aliases: ['BE'] },
    { merchantId: '431604', country: 'Bolivia', aliases: ['BO'] },
    { merchantId: '431605', country: 'Brazil', aliases: ['BR'] },
    { merchantId: '431606', country: 'Cambodia', aliases: ['KH'] },
    { merchantId: '431607', country: 'Canada', aliases: ['CA'] },
    { merchantId: '431608', country: 'Chile', aliases: ['CL'] },
    { merchantId: '431609', country: 'China', aliases: ['CN'] },
    { merchantId: '431610', country: 'Colombia', aliases: ['CO'] },
    { merchantId: '431611', country: 'Cyprus', aliases: ['CY'] },
    { merchantId: '431612', country: 'Czech Republic', aliases: ['CZ', 'Czechia'] },
    { merchantId: '431613', country: 'Denmark', aliases: ['DK'] },
    { merchantId: '431614', country: 'Dominican Republic', aliases: ['DO'] },
    { merchantId: '431615', country: 'Ecuador', aliases: ['EC'] },
    { merchantId: '431616', country: 'Egypt', aliases: ['EG'] },
    { merchantId: '431617', country: 'Estonia', aliases: ['EE'] },
    { merchantId: '431618', country: 'Finland', aliases: ['FI'] },
    { merchantId: '431619', country: 'France', aliases: ['FR'] },
    { merchantId: '431620', country: 'Germany', aliases: ['DE'] },
    { merchantId: '431621', country: 'Ghana', aliases: ['GH'] },
    { merchantId: '431622', country: 'Greece', aliases: ['GR'] },
    { merchantId: '431623', country: 'Guatemala', aliases: ['GT'] },
    { merchantId: '431624', country: 'Hong Kong (香港地區)', aliases: ['HK', 'Hong Kong'] },
    { merchantId: '431625', country: 'Hungary', aliases: ['HU'] },
    { merchantId: '431626', country: 'India', aliases: ['IN'] },
    { merchantId: '431627', country: 'Indonesia', aliases: ['ID'] },
    { merchantId: '431628', country: 'Iraq', aliases: ['IQ'] },
    { merchantId: '431629', country: 'Israel', aliases: ['IL'] },
    { merchantId: '431630', country: 'Italy', aliases: ['IT'] },
    { merchantId: '431631', country: 'Japan', aliases: ['JP'] },
    { merchantId: '431632', country: 'Kazakhstan', aliases: ['KZ'] },
    { merchantId: '431633', country: 'Kenya', aliases: ['KE'] },
    { merchantId: '431634', country: 'Kuwait', aliases: ['KW'] },
    { merchantId: '431635', country: 'Laos', aliases: ['LA', 'Lao PDR'] },
    { merchantId: '431636', country: 'Latvia', aliases: ['LV'] },
    { merchantId: '431637', country: 'Lithuania', aliases: ['LT'] },
    { merchantId: '431638', country: 'Luxembourg', aliases: ['LU'] },
    { merchantId: '431639', country: 'Malaysia', aliases: ['MY'] },
    { merchantId: '431640', country: 'Malta', aliases: ['MT'] },
    { merchantId: '431641', country: 'Mexico', aliases: ['MX'] },
    { merchantId: '431642', country: 'Mongolia', aliases: ['MN'] },
    { merchantId: '431643', country: 'Morocco', aliases: ['MA'] },
    { merchantId: '431644', country: 'Myanmar', aliases: ['MM', 'Burma'] },
    { merchantId: '431645', country: 'Nepal', aliases: ['NP'] },
    { merchantId: '431646', country: 'Netherlands', aliases: ['NL'] },
    { merchantId: '431647', country: 'New Zealand', aliases: ['NZ'] },
    { merchantId: '431648', country: 'Nigeria', aliases: ['NG'] },
    { merchantId: '431649', country: 'Norway', aliases: ['NO'] },
    { merchantId: '431650', country: 'Pakistan', aliases: ['PK'] },
    { merchantId: '431651', country: 'Palestine', aliases: ['PS'] },
    { merchantId: '431652', country: 'Paraguay', aliases: ['PY'] },
    { merchantId: '431653', country: 'Peru', aliases: ['PE'] },
    { merchantId: '431654', country: 'Philippines', aliases: ['PH'] },
    { merchantId: '431655', country: 'Poland', aliases: ['PL'] },
    { merchantId: '431656', country: 'Portugal', aliases: ['PT'] },
    { merchantId: '431657', country: 'Puerto Rico', aliases: ['PR'] },
    { merchantId: '431658', country: 'Qatar', aliases: ['QA'] },
    { merchantId: '431659', country: 'Republic of Ireland', aliases: ['IE', 'Ireland'] },
    { merchantId: '431660', country: 'Romania', aliases: ['RO'] },
    { merchantId: '431661', country: 'Saudi Arabia', aliases: ['SA'] },
    { merchantId: '431662', country: 'Singapore', aliases: ['SG'] },
    { merchantId: '431663', country: 'Slovakia', aliases: ['SK'] },
    { merchantId: '431664', country: 'Slovenia', aliases: ['SI'] },
    { merchantId: '431665', country: 'South Africa', aliases: ['ZA'] },
    { merchantId: '431666', country: 'South Korea', aliases: ['KR', 'Korea'] },
    { merchantId: '431667', country: 'Spain', aliases: ['ES'] },
    { merchantId: '431668', country: 'Sri Lanka', aliases: ['LK'] },
    { merchantId: '431669', country: 'Sweden', aliases: ['SE'] },
    { merchantId: '431670', country: 'Switzerland', aliases: ['CH'] },
    { merchantId: '431671', country: 'Taiwan (台灣地區)', aliases: ['TW', 'Taiwan'] },
    { merchantId: '431672', country: 'Thailand', aliases: ['TH'] },
    { merchantId: '431673', country: 'Timor Leste', aliases: ['TL', 'East Timor'] },
    { merchantId: '431674', country: 'Tunisia', aliases: ['TN'] },
    { merchantId: '431675', country: 'Turkey', aliases: ['TR', 'Türkiye'] },
    { merchantId: '431676', country: 'Ukraine', aliases: ['UA'] },
    { merchantId: '431677', country: 'United Arab Emirates', aliases: ['AE', 'UAE'] },
    { merchantId: '431678', country: 'Great Britain (UK, Scotland, Wales)', aliases: ['GB', 'UK', 'United Kingdom', 'Great Britain', 'Scotland', 'Wales'] },
    { merchantId: '431679', country: 'United States of America', aliases: ['US', 'USA', 'United States', 'America'] },
    { merchantId: '431680', country: 'Uruguay', aliases: ['UY'] },
    { merchantId: '431681', country: 'Uzbekistan', aliases: ['UZ'] },
    { merchantId: '431682', country: 'Vietnam', aliases: ['VN', 'Viet Nam'] }
]);

function normalizeCountry(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/\([^)]*\)/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeMerchantId(value) {
    return String(value || '').trim();
}

function getCodaMerchantByCountry(country) {
    const normalizedCountry = normalizeCountry(country);
    if (!normalizedCountry) return null;

    return CODA_MERCHANTS.find(merchant => {
        const names = [merchant.country].concat(merchant.aliases || []);
        return names.some(name => normalizeCountry(name) === normalizedCountry);
    }) || null;
}

function getCodaMerchantById(merchantId) {
    const normalizedMerchantId = normalizeMerchantId(merchantId);
    if (!normalizedMerchantId) return null;
    return CODA_MERCHANTS.find(merchant => merchant.merchantId === normalizedMerchantId) || null;
}

function getCodaMerchantIdForCountry(country) {
    const merchant = getCodaMerchantByCountry(country);
    return merchant ? merchant.merchantId : '';
}

function isKnownCodaMerchantForCountry(merchantId, country) {
    const merchant = getCodaMerchantByCountry(country);
    return Boolean(merchant && merchant.merchantId === normalizeMerchantId(merchantId));
}

module.exports = {
    CODA_MERCHANTS,
    getCodaMerchantByCountry,
    getCodaMerchantById,
    getCodaMerchantIdForCountry,
    isKnownCodaMerchantForCountry,
    normalizeCountry,
    normalizeMerchantId
};

(() => {
    const TEMPLATE_REGISTRY = {
        'fashion-store-template': {
            id: 'fashion-store-template',
            slug: 'fashion-store-template',
            name: 'Fashion Store',
            category: 'E-commerce',
            page: 'fashion-store-template.html',
            image: 'images/f4.avif',
            description: 'A stylish storefront designed for premium ecommerce brands.'
        },
        'photographer-template': {
            id: 'photographer-template',
            slug: 'photographer-template',
            name: 'Photographer',
            category: 'Photography',
            page: 'photographer-template.html',
            image: 'images/photogrPHER.avif',
            description: 'A visual-first photography portfolio built for bookings.'
        },
        'startup-landing-template': {
            id: 'startup-landing-template',
            slug: 'startup-landing-template',
            name: 'Startup Landing',
            category: 'Business',
            page: 'startup-landing-template.html',
            image: 'images/startup.avif',
            description: 'A conversion-focused startup landing page for launches and demos.'
        },
        'fine-dining-template': {
            id: 'fine-dining-template',
            slug: 'fine-dining-template',
            name: 'Fine Dining',
            category: 'Restaurant',
            page: 'fine-dining-template.html',
            image: 'images/dinner.jpg',
            description: 'A refined hospitality website designed to drive reservations.'
        },
        'cafe-bakery-template': {
            id: 'cafe-bakery-template',
            slug: 'cafe-bakery-template',
            name: 'Cafe & Bakery',
            category: 'Restaurant',
            page: 'cafe-bakery-template.html',
            image: 'images/cafe.webp',
            description: 'A warm cafe and bakery template for local food brands.'
        },
        'wedding-gallery-template': {
            id: 'wedding-gallery-template',
            slug: 'wedding-gallery-template',
            name: 'Wedding Gallery',
            category: 'Photography',
            page: 'wedding-gallery-template.html',
            image: 'images/wedding.jpg',
            description: 'An elegant wedding showcase for story-led galleries and inquiries.'
        },
        'digital-marketing-template': {
            id: 'digital-marketing-template',
            slug: 'digital-marketing-template',
            name: 'Digital Marketing',
            category: 'Agency',
            page: 'digital-marketing-template.html',
            image: 'images/digital.jpg',
            description: 'A results-driven agency template for growth and campaign services.'
        },
        'jewelry-luxury-template': {
            id: 'jewelry-luxury-template',
            slug: 'jewelry-luxury-template',
            name: 'Jewelry & Luxury',
            category: 'E-commerce',
            page: 'jewelry-luxury-template.html',
            image: 'images/luxury.jpg',
            description: 'A premium ecommerce layout tailored for luxury collections.'
        }
    };

    function getTemplateConfig(templateIdOrPage) {
        const normalized = String(templateIdOrPage || '')
            .trim()
            .toLowerCase()
            .replace(/\.html$/, '');

        if (!normalized) return null;

        return TEMPLATE_REGISTRY[normalized]
            || Object.values(TEMPLATE_REGISTRY).find(template => template.page.toLowerCase() === `${normalized}.html`)
            || null;
    }

    function getTemplateByPage(pageName) {
        return Object.values(TEMPLATE_REGISTRY).find(template => template.page === pageName) || null;
    }

    window.NEXLANCE_TEMPLATE_REGISTRY = TEMPLATE_REGISTRY;
    window.getTemplateConfig = getTemplateConfig;
    window.getTemplateConfigByPage = getTemplateByPage;
})();

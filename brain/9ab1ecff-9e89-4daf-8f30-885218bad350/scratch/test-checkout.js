const http = require('http');

function postJson(url, body) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const req = http.request({
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: parsedUrl.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            }
        }, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve({
                        statusCode: res.statusCode,
                        body: JSON.parse(data)
                    });
                } catch (e) {
                    resolve({
                        statusCode: res.statusCode,
                        body: data
                    });
                }
            });
        });
        req.on('error', reject);
        req.write(JSON.stringify(body));
        req.end();
    });
}

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve({
                        statusCode: res.statusCode,
                        body: JSON.parse(data)
                    });
                } catch (e) {
                    resolve({
                        statusCode: res.statusCode,
                        body: data
                    });
                }
            });
        }).on('error', reject);
    });
}

const firebaseService = require('../services/firebase-service');

async function getOrCreateTestUser() {
    const email = 'mehrahinal113@gmail.com';
    const existing = await firebaseService.findUserDocumentByEmail(email);
    if (existing) {
        console.log(`Found existing test user: ${email}`);
        return existing.data;
    }

    console.log(`Creating mock user in Firestore for testing: ${email}`);
    const user = {
        email: email,
        name: 'Hinal Mehra',
        currentPlan: 'Individual',
        planCode: 'individual',
        planPaid: false,
        ownedTemplateIds: [],
        createdAt: new Date().toISOString()
    };
    await firebaseService.upsertCollectionDocument('users', email, user);
    return user;
}

async function main() {
    console.log('--- E2E Checkout Integration Test (Simulation Mode) ---');
    
    // 1. Get/create user
    const user = await getOrCreateTestUser();
    
    const baseUrl = 'http://localhost:4242';
    
    // 2. Test Stripe Checkout for Plus Plan
    console.log('\n--- 1. Testing Stripe Plus Plan Purchase ---');
    const stripeStart = await postJson(`${baseUrl}/api/checkout-start`, {
        provider: 'stripe',
        productCode: 'plus_monthly',
        userEmail: user.email,
        userName: user.name || 'Test User',
        siteBaseUrl: baseUrl
    });
    console.log('Stripe checkout-start response:', JSON.stringify(stripeStart.body, null, 2));
    
    if (stripeStart.body && stripeStart.body.sessionId) {
        const stripeComplete = await postJson(`${baseUrl}/api/checkout-complete`, {
            provider: 'stripe',
            sessionId: stripeStart.body.sessionId
        });
        console.log('Stripe checkout-complete response:', JSON.stringify(stripeComplete.body, null, 2));
        
        // Fetch updated user from firestore
        const updatedUser = await firebaseService.findUserDocumentByEmail(user.email);
        console.log('Updated user plan after Stripe checkout:', updatedUser.data.currentPlan, updatedUser.data.planPaid);
    } else {
        console.error('Failed to create Stripe checkout session.');
    }
    
    // 3. Test Polar Checkout for Business Plan
    console.log('\n--- 2. Testing Polar Business Plan Purchase ---');
    const polarStart = await postJson(`${baseUrl}/api/checkout-start`, {
        provider: 'polar',
        productCode: 'business_monthly',
        userEmail: user.email,
        userName: user.name || 'Test User',
        siteBaseUrl: baseUrl
    });
    console.log('Polar checkout-start response:', JSON.stringify(polarStart.body, null, 2));
    
    if (polarStart.body && polarStart.body.checkoutId) {
        const polarComplete = await postJson(`${baseUrl}/api/checkout-complete`, {
            provider: 'polar',
            checkoutId: polarStart.body.checkoutId
        });
        console.log('Polar checkout-complete response:', JSON.stringify(polarComplete.body, null, 2));
        
        // Fetch updated user from firestore
        const updatedUser = await firebaseService.findUserDocumentByEmail(user.email);
        console.log('Updated user plan after Polar checkout:', updatedUser.data.currentPlan, updatedUser.data.planPaid);
    } else {
        console.error('Failed to create Polar checkout session.');
    }
}

main().catch(err => {
    console.error('E2E Test Failed:', err);
});

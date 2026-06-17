const fetch = require('node-fetch'); 
async function test() {
    const response = await fetch('https://api.creem.io/v1/checkouts', {
        method: 'POST',
        headers: {
            'x-api-key': 'creem_2cTcuIy8DsvnphTdBLOGXL',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            product_id: 'prod_Ej5IjCygT94fcUF94sSKB',
            success_url: 'http://localhost:4242/pricing.html?checkout_result=success',
            metadata: {
                flow: "plan_purchase",
                product_code: "plus_monthly",
                plan_code: "plus",
                user_email: "mehrahinal113@gmail.com",
                user_name: "Hinal",
                template_id: "",
                template_name: "",
                billing_type: "subscription",
                billing_cycle: "monthly"
            }
        })
    });
    const data = await response.json();
    console.log(JSON.stringify(data, null, 2));
}
test();

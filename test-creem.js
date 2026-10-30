const fetchFn = globalThis.fetch || require('node-fetch');
async function test() {
    const response = await fetchFn('https://api.creem.io/v1/checkouts', {
        method: 'POST',
        headers: {
            'x-api-key': 'creem_2cTcuIy8DsvnphTdBLOGXL',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            product_id: 'prod_Ej5IjCygT94fcUF94sSKB',
            success_url: 'http://localhost:4242/pricing.html?checkout_result=success'
        })
    });
    const data = await response.json();
    console.log(JSON.stringify(data, null, 2));
}
test();

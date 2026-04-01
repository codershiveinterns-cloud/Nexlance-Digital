const fs = require('fs');
const path = require('path');
const { sendEmailWithResend } = require('../services/email-service');

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const ENV_PATH = path.join(PROJECT_ROOT, '.env');

function loadEnvFile(envPath = ENV_PATH) {
    if (!fs.existsSync(envPath)) return;

    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;

        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex === -1) return;

        const key = trimmed.slice(0, separatorIndex).trim();
        let value = trimmed.slice(separatorIndex + 1).trim();
        if (!key || process.env[key] !== undefined) return;

        if (
            (value.startsWith('"') && value.endsWith('"'))
            || (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }

        process.env[key] = value;
    });
}

async function main() {
    loadEnvFile();

    const cliRecipient = String(process.argv[2] || '').trim();
    const fallbackRecipient = String(process.env.RESEND_DEV_TO_EMAIL || '').trim();
    const requestedRecipient = cliRecipient || fallbackRecipient;

    if (!requestedRecipient) {
        throw new Error(
            'Provide a recipient email as the first argument, or set RESEND_DEV_TO_EMAIL in your .env file.'
        );
    }

    const now = new Date().toISOString();
    console.log('[email:test] Sending a Resend test message...', {
        requestedRecipient,
        environment: process.env.NODE_ENV || 'development'
    });

    const result = await sendEmailWithResend({
        to: requestedRecipient,
        subject: `Nexlance Resend test - ${now}`,
        html: `
            <div style="font-family:Arial,sans-serif;padding:24px;">
                <h1 style="margin:0 0 12px;">Resend test successful</h1>
                <p style="margin:0 0 8px;">This email was sent by the local Nexlance test script.</p>
                <p style="margin:0;">Timestamp: <strong>${now}</strong></p>
            </div>
        `,
        text: `Resend test successful. Timestamp: ${now}`
    });

    console.log('[email:test] Email request completed successfully.');
    console.log(JSON.stringify(result, null, 2));
}

main().catch(error => {
    console.error('[email:test] Email test failed.');
    console.error(error && error.message ? error.message : error);
    if (error && error.emailDiagnostics) {
        console.error(JSON.stringify(error.emailDiagnostics, null, 2));
    }
    process.exitCode = 1;
});

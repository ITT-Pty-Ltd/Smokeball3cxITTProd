function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function renderContactPage(contact, smokeballAppUrl) {
    const name =
        [contact.firstName, contact.lastName].filter(Boolean).join(' ') ||
        contact.company ||
        'Unknown';
    const company = contact.company ? `<p><strong>Company:</strong> ${escapeHtml(contact.company)}</p>` : '';
    const phone = contact.phone ? `<p><strong>Phone:</strong> ${escapeHtml(contact.phone)}</p>` : '';
    const email = contact.email ? `<p><strong>Email:</strong> ${escapeHtml(contact.email)}</p>` : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(name)} – Smokeball Contact</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 32px; max-width: 420px; width: 100%; }
    h1 { margin: 0 0 8px; font-size: 1.5rem; }
    .sub { color: #94a3b8; font-size: 0.875rem; margin-bottom: 24px; }
    p { margin: 8px 0; line-height: 1.5; }
    a.btn { display: inline-block; margin-top: 24px; background: #3b82f6; color: #fff; text-decoration: none; padding: 12px 20px; border-radius: 8px; font-weight: 600; }
    a.btn:hover { background: #2563eb; }
    .hint { margin-top: 16px; font-size: 0.8rem; color: #64748b; }
  </style>
</head>
<body>
  <div class="card">
    <h1>${escapeHtml(name)}</h1>
    <p class="sub">Matched from Smokeball</p>
    ${company}${phone}${email}
    <a class="btn" href="${escapeHtml(smokeballAppUrl)}/" target="_blank" rel="noopener">Open Smokeball</a>
    <p class="hint">Search for this contact in Smokeball using the details above. Smokeball does not provide a public browser link per contact.</p>
  </div>
</body>
</html>`;
}

function renderNotFoundPage() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Contact not found</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0f172a; color: #f8fafc; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 24px; }
    .card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 32px; max-width: 420px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Contact not available</h1>
    <p>This link expires after an hour. Place or receive another call to refresh the contact match.</p>
  </div>
</body>
</html>`;
}

module.exports = { renderContactPage, renderNotFoundPage };

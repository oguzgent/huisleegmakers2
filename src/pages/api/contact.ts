import type { APIRoute } from 'astro';

export const prerender = false;

const ALLOWED_TYPES = ['woningontruiming', 'overlijden', 'bedrijfsontruiming', 'spoedontruiming', 'anders'];
const MAX_FIELD_LENGTH = 500;
const MAX_NAME_LENGTH = 100;

export const POST: APIRoute = async ({ request }) => {
  try {
    // CSRF: check Origin/Referer header
    const origin = request.headers.get('origin') || request.headers.get('referer') || '';
    const allowedOrigins = ['https://huisleegmakers.gent', 'https://huisleegmakers2.vercel.app', 'https://huisleegmakers-kohl.vercel.app', 'http://localhost:4321', 'http://localhost:4322'];
    const isAllowed = allowedOrigins.some(o => origin.startsWith(o));
    if (!isAllowed) {
      return new Response(JSON.stringify({ error: 'Ongeldig verzoek.' }), { status: 403 });
    }

    const data = await request.formData();

    // Honeypot check
    if (data.get('website')) {
      return new Response(JSON.stringify({ message: 'OK' }), { status: 200 });
    }

    const naam = data.get('naam')?.toString().trim().slice(0, MAX_NAME_LENGTH);
    const telefoon = data.get('telefoon')?.toString().trim().slice(0, 30);
    const email = data.get('email')?.toString().trim().slice(0, 254);
    const locatie = data.get('locatie')?.toString().trim().slice(0, MAX_NAME_LENGTH);
    const type = data.get('type')?.toString().trim();
    const beschrijving = data.get('beschrijving')?.toString().trim().slice(0, MAX_FIELD_LENGTH);

    if (!naam || !telefoon || !locatie || !type) {
      return new Response(
        JSON.stringify({ error: 'Vul alle verplichte velden in.' }),
        { status: 400 }
      );
    }

    // Validate type against whitelist
    if (!ALLOWED_TYPES.includes(type)) {
      return new Response(
        JSON.stringify({ error: 'Ongeldig type ontruiming.' }),
        { status: 400 }
      );
    }

    // Validate phone format (Belgian/international numbers)
    const phoneRegex = /^[\+]?[0-9\s\-\(\)\.]{6,20}$/;
    if (!phoneRegex.test(telefoon)) {
      return new Response(
        JSON.stringify({ error: 'Ongeldig telefoonnummer.' }),
        { status: 400 }
      );
    }

    // Validate email if provided
    if (email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return new Response(
          JSON.stringify({ error: 'Ongeldig e-mailadres.' }),
          { status: 400 }
        );
      }
    }

    const resendApiKey = import.meta.env.RESEND_API_KEY;

    if (!resendApiKey) {
      console.error('Email service not configured');
      return new Response(
        JSON.stringify({ error: 'Server configuratiefout.' }),
        { status: 500 }
      );
    }

    const htmlBody = `
      <h2>Nieuwe offerte aanvraag via huisleegmakers.gent</h2>
      <table style="border-collapse:collapse;width:100%;max-width:600px;">
        <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Naam</td><td style="padding:8px;border:1px solid #ddd;">${escapeHtml(naam)}</td></tr>
        <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Telefoon</td><td style="padding:8px;border:1px solid #ddd;"><a href="tel:${escapeHtml(telefoon)}">${escapeHtml(telefoon)}</a></td></tr>
        <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">E-mail</td><td style="padding:8px;border:1px solid #ddd;">${email ? `<a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a>` : '-'}</td></tr>
        <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Locatie</td><td style="padding:8px;border:1px solid #ddd;">${escapeHtml(locatie)}</td></tr>
        <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Type ontruiming</td><td style="padding:8px;border:1px solid #ddd;">${escapeHtml(type)}</td></tr>
        <tr><td style="padding:8px;border:1px solid #ddd;font-weight:bold;">Beschrijving</td><td style="padding:8px;border:1px solid #ddd;">${beschrijving ? escapeHtml(beschrijving) : '-'}</td></tr>
      </table>
    `;

    // Sanitize email headers to prevent injection
    const safeNaam = sanitizeHeader(naam);
    const safeType = sanitizeHeader(type);
    const safeReplyTo = email ? sanitizeHeader(email) : undefined;

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${resendApiKey}`,
      },
      body: JSON.stringify({
        from: 'Huisleegmakers Website <noreply@huisleegmakers.gent>',
        to: ['info@huisleegmakers.gent'],
        subject: `Nieuwe offerte aanvraag: ${safeType} - ${safeNaam}`,
        html: htmlBody,
        reply_to: safeReplyTo,
      }),
    });

    if (!response.ok) {
      console.error('Email API error occurred');
      return new Response(
        JSON.stringify({ error: 'Er ging iets mis bij het verzenden.' }),
        { status: 500 }
      );
    }

    // Bevestigingsmail naar de aanvrager (alleen als e-mail is ingevuld)
    if (email) {
      const typeLabels: Record<string, string> = {
        woningontruiming: 'Woningontruiming',
        overlijden: 'Ontruiming na overlijden',
        bedrijfsontruiming: 'Bedrijfsontruiming',
        spoedontruiming: 'Spoedontruiming',
        anders: 'Anders',
      };
      const typeLabel = typeLabels[type] || type;

      const confirmationHtml = buildConfirmationEmail(escapeHtml(naam), escapeHtml(typeLabel), escapeHtml(locatie));

      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${resendApiKey}`,
        },
        body: JSON.stringify({
          from: 'Huisleegmakers <noreply@huisleegmakers.gent>',
          to: [sanitizeHeader(email)],
          subject: 'Bedankt voor uw aanvraag - Huisleegmakers',
          html: confirmationHtml,
          reply_to: 'info@huisleegmakers.gent',
        }),
      }).catch(() => {
        // Bevestigingsmail falen mag de hoofdresponse niet blokkeren
      });
    }

    return new Response(
      JSON.stringify({ message: 'Uw aanvraag is succesvol verzonden!' }),
      { status: 200 }
    );
  } catch {
    console.error('Contact form error occurred');
    return new Response(
      JSON.stringify({ error: 'Er ging iets mis. Probeer het opnieuw.' }),
      { status: 500 }
    );
  }
};

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function sanitizeHeader(str: string): string {
  // Remove newlines and carriage returns to prevent header injection
  return str.replace(/[\r\n\t]/g, '').trim();
}

function buildConfirmationEmail(naam: string, type: string, locatie: string): string {
  return `
<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <div style="background:#1e40af;padding:32px 36px;">
    <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
      <td>
        <span style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.3px;">Huisleegmakers</span><br>
        <span style="font-size:13px;color:rgba(255,255,255,0.7);letter-spacing:0.5px;">PROFESSIONELE WONINGONTRUIMING</span>
      </td>
      <td align="right" valign="middle">
        <span style="display:inline-block;background:rgba(255,255,255,0.15);color:#ffffff;font-size:11px;font-weight:600;padding:6px 14px;border-radius:20px;letter-spacing:0.3px;">Bevestiging</span>
      </td>
    </tr></table>
  </div>
  <div style="padding:36px;">
    <p style="font-size:16px;color:#1e293b;margin:0 0 20px;line-height:1.6;">Beste <strong>${naam}</strong>,</p>
    <p style="font-size:15px;color:#475569;margin:0 0 24px;line-height:1.7;">Bedankt voor uw aanvraag. Wij hebben uw bericht goed ontvangen en nemen binnen <strong style="color:#1e293b;">24 uur</strong> persoonlijk contact met u op.</p>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:24px;margin:0 0 28px;">
      <p style="font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin:0 0 14px;">Uw aanvraag</p>
      <table cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr><td style="padding:6px 0;font-size:14px;color:#94a3b8;width:100px;">Type</td><td style="padding:6px 0;font-size:14px;color:#1e293b;font-weight:600;">${type}</td></tr>
        <tr><td style="padding:6px 0;font-size:14px;color:#94a3b8;width:100px;">Locatie</td><td style="padding:6px 0;font-size:14px;color:#1e293b;font-weight:600;">${locatie}</td></tr>
      </table>
    </div>
    <p style="font-size:12px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:1px;margin:0 0 16px;">Wat nu?</p>
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 28px;">
      <tr>
        <td style="padding:10px 0;vertical-align:top;width:36px;"><div style="width:28px;height:28px;background:#eff6ff;border-radius:8px;text-align:center;line-height:28px;font-size:13px;font-weight:700;color:#1e40af;">1</div></td>
        <td style="padding:10px 0;padding-left:12px;"><span style="font-size:14px;font-weight:600;color:#1e293b;">Wij bellen u binnen 24 uur</span><br><span style="font-size:13px;color:#64748b;">Om uw situatie te bespreken</span></td>
      </tr>
      <tr>
        <td style="padding:10px 0;vertical-align:top;width:36px;"><div style="width:28px;height:28px;background:#eff6ff;border-radius:8px;text-align:center;line-height:28px;font-size:13px;font-weight:700;color:#1e40af;">2</div></td>
        <td style="padding:10px 0;padding-left:12px;"><span style="font-size:14px;font-weight:600;color:#1e293b;">Gratis bezichtiging ter plaatse</span><br><span style="font-size:13px;color:#64748b;">Wij komen langs om alles te bekijken</span></td>
      </tr>
      <tr>
        <td style="padding:10px 0;vertical-align:top;width:36px;"><div style="width:28px;height:28px;background:#eff6ff;border-radius:8px;text-align:center;line-height:28px;font-size:13px;font-weight:700;color:#1e40af;">3</div></td>
        <td style="padding:10px 0;padding-left:12px;"><span style="font-size:14px;font-weight:600;color:#1e293b;">Vrijblijvende offerte</span><br><span style="font-size:13px;color:#64748b;">Helder, transparant, geen verborgen kosten</span></td>
      </tr>
    </table>
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:18px 20px;margin:0 0 8px;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
        <td><span style="font-size:14px;color:#991b1b;font-weight:600;">Spoed? Bel ons 24/7</span><br><span style="font-size:13px;color:#b91c1c;">Wij zijn dag en nacht bereikbaar</span></td>
        <td align="right" valign="middle"><a href="tel:+32478225633" style="display:inline-block;background:#dc2626;color:#ffffff;font-size:14px;font-weight:700;padding:10px 20px;border-radius:8px;text-decoration:none;">0478 22 56 33</a></td>
      </tr></table>
    </div>
  </div>
  <div style="border-top:1px solid #e2e8f0;padding:28px 36px;background:#f8fafc;">
    <p style="font-size:14px;color:#475569;margin:0 0 20px;line-height:1.5;">Met vriendelijke groeten,<br><strong style="color:#1e293b;">Team Huisleegmakers</strong></p>
    <table cellpadding="0" cellspacing="0" border="0"><tr>
      <td style="width:3px;background:#1e40af;border-radius:3px;" valign="top">&nbsp;</td>
      <td style="padding-left:16px;">
        <span style="font-size:15px;font-weight:800;color:#1e293b;letter-spacing:-0.2px;">Huisleegmakers</span><br>
        <span style="font-size:12px;color:#94a3b8;">Professionele Woningontruiming</span><br><br>
        <table cellpadding="0" cellspacing="0" border="0">
          <tr><td style="padding:3px 0;font-size:13px;color:#64748b;"><span style="color:#1e40af;font-weight:600;">&#9742;</span>&nbsp;&nbsp;<a href="tel:+32478225633" style="color:#1e293b;text-decoration:none;font-weight:500;">0478 22 56 33</a></td></tr>
          <tr><td style="padding:3px 0;font-size:13px;color:#64748b;"><span style="color:#1e40af;font-weight:600;">&#9993;</span>&nbsp;&nbsp;<a href="mailto:info@huisleegmakers.gent" style="color:#1e293b;text-decoration:none;font-weight:500;">info@huisleegmakers.gent</a></td></tr>
          <tr><td style="padding:3px 0;font-size:13px;color:#64748b;"><span style="color:#1e40af;font-weight:600;">&#9679;</span>&nbsp;&nbsp;<span style="color:#64748b;">Pinksterbloemstraat 3, 9030 Gent</span></td></tr>
          <tr><td style="padding:3px 0;font-size:13px;color:#64748b;"><span style="color:#1e40af;font-weight:600;">&#9679;</span>&nbsp;&nbsp;<a href="https://huisleegmakers.gent" style="color:#1e40af;text-decoration:none;font-weight:600;">huisleegmakers.gent</a></td></tr>
        </table>
      </td>
    </tr></table>
    <div style="margin-top:20px;padding-top:16px;border-top:1px solid #e2e8f0;">
      <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
        <td style="font-size:12px;color:#64748b;"><span style="color:#16a34a;">&#10003;</span> Gratis offerte&nbsp;&nbsp;&nbsp;<span style="color:#16a34a;">&#10003;</span> Bezemschoon&nbsp;&nbsp;&nbsp;<span style="color:#16a34a;">&#10003;</span> Verzekerd&nbsp;&nbsp;&nbsp;<span style="color:#16a34a;">&#10003;</span> Transparant</td>
      </tr></table>
    </div>
  </div>
  <div style="padding:16px 36px;background:#f1f5f9;text-align:center;">
    <p style="font-size:11px;color:#94a3b8;margin:0;line-height:1.5;">Dit is een automatisch bericht naar aanleiding van uw aanvraag via huisleegmakers.gent</p>
  </div>
</div>`;
}

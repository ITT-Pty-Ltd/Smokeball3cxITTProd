/**
 * Map a Smokeball contact to the shape 3CX expects.
 * Avoids "Company - Company" display when organisation contacts use company for both fields.
 */

function getDigitsFromPhoneObj(phoneObj) {
    if (!phoneObj) return '';
    return `${phoneObj.areaCode || ''}${phoneObj.number || ''}`.replace(/\D/g, '');
}

function formatPhoneDisplay(phoneObj) {
    if (!phoneObj) return '';
    const digits = getDigitsFromPhoneObj(phoneObj);
    if (!digits) return '';
    const ext = phoneObj.extension ? ` x${phoneObj.extension}` : '';
    return `${digits}${ext}`;
}

function formatContactFor3cx(contact, dialNumber) {
    const person = contact.person || {};
    const company = contact.company || {};
    const hasPerson = Boolean(person.firstName || person.lastName);
    const companyName = company.name || '';

    let phoneBusiness =
        formatPhoneDisplay(person.phone) ||
        formatPhoneDisplay(company.phone) ||
        '';
    const phoneBusiness2 = formatPhoneDisplay(person.phone2) || '';
    let phoneMobile = formatPhoneDisplay(person.cell) || '';

    // Ensure the dialled/searched number appears on at least one 3CX phone field (phonebook sync)
    if (dialNumber) {
        const dialDigits = String(dialNumber).replace(/\D/g, '');
        const known = [phoneMobile, phoneBusiness, phoneBusiness2].map((p) => p.replace(/\D/g, ''));
        const alreadyPresent = known.some(
            (d) => d && dialDigits && (d.endsWith(dialDigits) || dialDigits.endsWith(d))
        );
        if (!alreadyPresent) {
            if (!phoneMobile) phoneMobile = dialNumber;
            else if (!phoneBusiness) phoneBusiness = dialNumber;
        }
    }

    const primaryPhone = dialNumber || phoneMobile || phoneBusiness || phoneBusiness2 || '';

    const base = {
        id: contact.id,
        phone: primaryPhone,
        phoneBusiness,
        phoneBusiness2,
        phoneMobile,
        email: person.email || company.email || '',
    };

    if (hasPerson) {
        return {
            ...base,
            firstName: person.firstName || '',
            lastName: person.lastName || '',
            company: companyName,
        };
    }

    return {
        ...base,
        firstName: '',
        lastName: '',
        company: companyName || 'Unknown',
    };
}

module.exports = { formatContactFor3cx, formatPhoneDisplay, getDigitsFromPhoneObj };

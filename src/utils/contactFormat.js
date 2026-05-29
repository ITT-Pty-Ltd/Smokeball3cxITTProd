/**
 * Map a Smokeball contact to the shape 3CX expects.
 * Avoids "Company - Company" display when organisation contacts use company for both fields.
 */
function formatContactFor3cx(contact, dialNumber) {
    const person = contact.person || {};
    const company = contact.company || {};
    const hasPerson = Boolean(person.firstName || person.lastName);
    const companyName = company.name || '';

    if (hasPerson) {
        return {
            id: contact.id,
            firstName: person.firstName || '',
            lastName: person.lastName || '',
            company: companyName,
            phone: dialNumber,
            email: person.email || company.email || '',
        };
    }

    return {
        id: contact.id,
        firstName: '',
        lastName: '',
        company: companyName || 'Unknown',
        phone: dialNumber,
        email: company.email || '',
    };
}

module.exports = { formatContactFor3cx };

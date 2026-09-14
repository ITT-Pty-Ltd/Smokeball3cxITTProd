/**
 * Normalise AU phone numbers for comparison.
 * 3CX often sends +61… while Smokeball stores 0… prefixed numbers.
 */

function getDigitsFromPhoneObj(phoneObj) {
    if (!phoneObj) return '';
    const area = (phoneObj.areaCode || '').replace(/\D/g, '');
    const num = (phoneObj.number || '').replace(/\D/g, '');
    if (!area) return num;
    if (!num) return area;
    if (num.startsWith('0') || num.startsWith(area)) return num;
    return `${area}${num}`;
}

/** Canonical AU local form: 0290115974 */
function canonicalAuDigits(phoneNumber) {
    let digits = String(phoneNumber || '').replace(/\D/g, '');
    if (!digits) return '';

    if (digits.startsWith('61') && digits.length >= 11) {
        digits = digits.slice(2);
    }

    if (digits && !digits.startsWith('0') && digits.length >= 9) {
        digits = `0${digits}`;
    }

    return digits;
}

function phoneDigitsMatch(inputNumber, storedNumber) {
    const a = canonicalAuDigits(inputNumber);
    const b = canonicalAuDigits(storedNumber);
    if (!a || !b) return false;
    if (a === b) return true;

    const tail = 8;
    if (a.length >= tail && b.length >= tail) {
        return a.slice(-tail) === b.slice(-tail);
    }

    return a.endsWith(b) || b.endsWith(a);
}

function phoneMatchesContact(inputNumber, contact) {
    if (!inputNumber) return false;

    if (contact.person) {
        for (const ph of [contact.person.phone, contact.person.phone2, contact.person.cell]) {
            if (phoneDigitsMatch(inputNumber, getDigitsFromPhoneObj(ph))) return true;
        }
    }

    if (contact.company?.phone) {
        return phoneDigitsMatch(inputNumber, getDigitsFromPhoneObj(contact.company.phone));
    }

    return false;
}

/** Build Smokeball Search terms (phone:*value*) for progressive lookup attempts. */
function buildPhoneSearchTerms(phoneNumber) {
    const digits = phoneNumber.replace(/\D/g, '');
    const candidates = [];

    const addDigits = (d) => {
        if (d && d.length >= 4) candidates.push(d);
    };

    addDigits(digits);
    if (digits.length >= 8) addDigits(digits.slice(-8));
    if (digits.length >= 6) addDigits(digits.slice(-6));

    const canonical = canonicalAuDigits(phoneNumber);
    if (canonical && canonical !== digits) {
        addDigits(canonical);
        if (canonical.length >= 8) addDigits(canonical.slice(-8));
    }

    if (digits.startsWith('61') && digits.length > 10) {
        const local = digits.slice(2);
        addDigits(local);
        if (!local.startsWith('0')) {
            addDigits(`0${local}`);
        }
        if (local.length >= 8) addDigits(local.slice(-8));
    }

    if (digits.startsWith('0') && digits.length > 1) {
        const local = digits.slice(1);
        addDigits(local);
        if (local.length >= 8) addDigits(local.slice(-8));
    }

    return [...new Set(candidates.map((d) => `phone:*${d}*`))];
}

module.exports = {
    getDigitsFromPhoneObj,
    canonicalAuDigits,
    phoneDigitsMatch,
    phoneMatchesContact,
    buildPhoneSearchTerms,
};

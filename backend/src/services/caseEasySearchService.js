const clean = (value, max = 120) =>
  String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, max);

function contains(value) {
  return { contains: value, mode: "insensitive" };
}

function phoneParts(value) {
  const digits = String(value || "").replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (national.length !== 10) return [];
  return [national.slice(0, 3), national.slice(3, 6), national.slice(6)];
}

function formattedPhoneMatch(field, value) {
  const parts = phoneParts(value);
  return parts.length ? { AND: parts.map((part) => ({ [field]: contains(part) })) } : null;
}

export function cleanCaseEasySearch(value) {
  return clean(value);
}

// Match every word somewhere in the imported identity. This makes a full
// name such as "Gagandeep Singh" work even though Case Easy stores first and
// last names in separate columns. Linked case identity is included so a case
// number can locate its parent imported contact.
export function buildCaseEasyContactSearchWhere(value) {
  const query = cleanCaseEasySearch(value);
  if (!query) return null;
  const terms = query.split(" ").filter(Boolean).slice(0, 8);

  return {
    AND: terms.map((term) => {
      const digits = term.replace(/\D/g, "");
      const phoneNeedle = digits.length >= 3 ? digits : null;
      const contactFormattedPhone = formattedPhoneMatch("phone", term);
      const contactFields = [
        { firstName: contains(term) },
        { lastName: contains(term) },
        { email: contains(term) },
        { phone: contains(term) },
        { clientIdentifier: contains(term) },
        { uci: contains(term) },
        { convertedClient: { clientNumber: contains(term) } },
        { convertedClient: { fullName: contains(term) } },
      ];
      if (phoneNeedle && phoneNeedle !== term) {
        contactFields.push({ phone: contains(phoneNeedle) });
      }
      if (contactFormattedPhone) contactFields.push(contactFormattedPhone);
      const linkedFormattedPhone = formattedPhoneMatch("phone", term);
      contactFields.push({
        linkedCases: {
          some: {
            OR: [
              { caseNumber: contains(term) },
              { clientIdentifier: contains(term) },
              { firstName: contains(term) },
              { lastName: contains(term) },
              { email: contains(term) },
              { phone: contains(term) },
              { otherEmails: contains(term) },
              { companyName: contains(term) },
              ...(phoneNeedle && phoneNeedle !== term
                ? [{ phone: contains(phoneNeedle) }]
                : []),
              ...(linkedFormattedPhone ? [linkedFormattedPhone] : []),
            ],
          },
        },
      });
      return { OR: contactFields };
    }),
  };
}

const EMAIL_PATTERN = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function emailCandidates(client) {
  if (!client || typeof client !== "object") return [];
  const nested = client.client && typeof client.client === "object" ? client.client : {};
  const contact = client.contact && typeof client.contact === "object" ? client.contact : {};
  return [
    client.email,
    client.client_email,
    client.email_address,
    nested.email,
    nested.client_email,
    nested.email_address,
    contact.email,
    contact.client_email,
  ];
}

function validEmail(value) {
  return Boolean(value) && value.length <= 254 && !value.includes("..") && EMAIL_PATTERN.test(value);
}

export function readSngClientEmail(client) {
  const present = emailCandidates(client).map(text).filter(Boolean);
  if (!present.length) return { email: "", reason: "blank" };
  const email = present.find(validEmail) || "";
  return email ? { email, reason: "" } : { email: "", reason: "invalid" };
}

export function sngClientEmail(client) {
  return readSngClientEmail(client).email;
}

function phoneText(value) {
  if (typeof value === "number" && Number.isFinite(value)) return String(Math.trunc(Math.abs(value)));
  return text(value);
}

function phoneDigits(value) {
  return phoneText(value).replace(/\D/g, "");
}

function phoneCandidates(client) {
  if (!client || typeof client !== "object") return [];
  const nested = client.client && typeof client.client === "object" ? client.client : {};
  const contact = client.contact && typeof client.contact === "object" ? client.contact : {};
  return [
    client.cell_phone,
    client.cell_phone_number,
    client.mobile,
    client.mobile_phone,
    client.phone,
    client.phone_number,
    client.home_phone,
    client.home_phone_number,
    nested.cell_phone,
    nested.cell_phone_number,
    nested.phone,
    nested.home_phone,
    contact.cell_phone_number,
    contact.cell_phone,
    contact.phone,
    contact.home_phone,
  ];
}

function usablePhone(value) {
  const phone = phoneText(value);
  if (!phone || phone.length > 40) return "";
  const digits = phoneDigits(phone);
  const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  return national.length >= 10 && national.length <= 15 ? phone : "";
}

export function readSngClientPhone(client) {
  const present = phoneCandidates(client).map(phoneText).filter(Boolean);
  if (!present.length) return { phone: "", reason: "blank" };
  const phone = present.map(usablePhone).find(Boolean) || "";
  return phone ? { phone, reason: "" } : { phone: "", reason: "invalid" };
}

export function sngClientPhone(client) {
  return readSngClientPhone(client).phone;
}

// Writes Customers Email (fldvPD16o3KFGl9gS) when Sweep & Go has a usable
// address that differs. Blank or invalid provider values are omitted so an
// existing email is left in place and the rest of the record can still sync.
export function assignAirtableEmail(target, currentEmail, client) {
  const email = sngClientEmail(client);
  if (!email) return false;
  if (text(currentEmail).toLowerCase() === email.toLowerCase()) return false;
  target.Email = email;
  return true;
}

// Writes Customers Phone (fld6ZCwqkM4KOK1oA). Cell phone is preferred over
// home phone. Blank or unusable numbers are omitted and never clear a stored phone.
export function assignAirtablePhone(target, currentPhone, client) {
  const phone = sngClientPhone(client);
  if (!phone) return false;
  if (phoneDigits(currentPhone) && phoneDigits(currentPhone) === phoneDigits(phone)) return false;
  target.Phone = phone;
  return true;
}

export function assignAirtableContact(target, current, client) {
  const emailChanged = assignAirtableEmail(target, current?.Email, client);
  const phoneChanged = assignAirtablePhone(target, current?.Phone, client);
  return emailChanged || phoneChanged;
}

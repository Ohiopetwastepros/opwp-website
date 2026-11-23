const EMAIL = /^[^\s@]{1,120}@[^\s@]{1,120}\.[^\s@]{2,63}$/;
const present = (value) => typeof value === "string" && Boolean(value.trim());
const validPhone = (value) => {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 10 && digits.length <= 15;
};

// A missing verification token keeps the button visually unavailable, but lets
// a tap explain the verification problem instead of silently swallowing it.
export function quoteSubmitState(missing, token, busy = false) {
  const missingItems = [...missing, ...(!token ? ["complete the security check"] : [])];
  return {
    valid: missing.length === 0,
    ready: missingItems.length === 0 && !busy,
    disabled: missing.length > 0 || busy,
    missing: missingItems,
    error: missing.length ? `Please ${missing.join(", ")}.` : !token ? "Please complete the verification and try again." : "",
  };
}

export function questionSubmitState({ name, phone, email, question, token, busy }) {
  const missing = [];
  if (!present(name)) missing.push("enter your name");
  if (!validPhone(phone) && !EMAIL.test(String(email || "").trim())) missing.push("enter a valid phone or email");
  if (!present(question)) missing.push("enter your question");
  return quoteSubmitState(missing, token, busy);
}

export function accountSubmitState(values) {
  const missing = [];
  for (const [key, label] of [
    ["firstName", "enter your first name"], ["lastName", "enter your last name"],
    ["address", "enter your home address"], ["city", "enter your city"],
    ["safeDog", "answer the dog safety question"], ["gateLocation", "select your gate location"],
    ["garbageCan", "select your garbage can location"], ["heardAbout", "select how you heard about us"],
  ]) if (!present(values[key])) missing.push(label);
  if (!EMAIL.test(String(values.email || "").trim())) missing.push("enter a valid email");
  if (!validPhone(values.phone)) missing.push("enter a valid phone number");
  if (!["OH", "MI"].includes(String(values.usState || "").trim())) missing.push("enter OH or MI for your state");
  if (!["yes", "no"].includes(values.cardChoice)) missing.push("choose how to continue");
  if (values.cardChoice === "no") {
    if (!present(values.serviceQuestion)) missing.push("enter your question");
    if (!values.createAccountBeforeCard) missing.push("choose the optional account creation path");
  }
  if (!values.termsAgreed) missing.push("agree to the service terms");
  return quoteSubmitState(missing, values.token, values.busy);
}
